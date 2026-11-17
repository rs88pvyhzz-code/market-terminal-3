"""Independent cash-income, adjusted-price, Sharpe and ingestion regressions."""
import datetime as dt
import json
import math
import pathlib
import shutil
import statistics
import subprocess
import unittest

import return_risk as rr

ROOT = pathlib.Path(__file__).resolve().parent


class ReturnRiskTests(unittest.TestCase):
    def test_cash_dividend_uses_prior_price_not_prior_price_plus_dividend(self):
        obs=rr.period_total_returns(
            [('2026-01-05',100),('2026-01-06',105),('2026-01-07',102)],
            {'2026-01-06':5},basis='cash_dividends'
        )
        self.assertAlmostEqual(obs[0][1],.10)
        self.assertAlmostEqual(obs[1][1],102/105-1)
        # Reinvesting each period's total cash return compounds the strategy.
        self.assertAlmostEqual(math.prod(1+x for _,x in obs),1.10*102/105)

    def test_adjusted_close_cannot_double_count_dividends(self):
        self.assertEqual(rr.period_total_returns(
            [('2026-01-05',100),('2026-01-06',110)],basis='adjusted'
        ),[('2026-01-06',.1 if False else 110/100-1)])
        with self.assertRaises(ValueError):
            rr.period_total_returns(
                [('2026-01-05',100),('2026-01-06',110)],
                {'2026-01-06':5},basis='adjusted'
            )
        with self.assertRaises(ValueError):
            rr.period_total_returns(
                [('2026-01-05',100),('2026-01-06',110)],
                {'2026-01-06':5},basis='price'
            )

    def test_cash_dividends_require_verified_dated_alignments(self):
        p=[('2026-01-05',100),('2026-01-06',95)]
        for bad in ({'2026-01-07':5},{'2026-01-06':-1},
                    {'2026-01-06':float('nan')}):
            with self.assertRaises(ValueError):
                rr.period_total_returns(p,bad,basis='cash_dividends')
        with self.assertRaises(ValueError):
            rr.period_total_returns([p[1],p[0]],basis='price')
        with self.assertRaises(ValueError):
            rr.period_total_returns([p[0],('2026-01-06',0)],basis='price')

    def test_risk_uses_sample_volatility_and_no_implicit_zero_risk_free(self):
        r=[-.02,.01,.03,-.01]
        result=rr.annualized_metrics(r)
        self.assertAlmostEqual(result['volatility'],statistics.stdev(r)*math.sqrt(252))
        self.assertAlmostEqual(result['annualized_arithmetic'],statistics.mean(r)*252)
        self.assertIsNone(result['sharpe'])
        rf=.0425
        with_rate=rr.annualized_metrics(r,risk_free_annual=rf)
        per=(1+rf)**(1/252)-1
        expected=math.sqrt(252)*(statistics.mean(r)-per)/statistics.stdev(r)
        self.assertAlmostEqual(with_rate['sharpe'],expected)
        self.assertNotEqual(with_rate['sharpe'],result['volatility'])

    def test_zero_volatility_is_unavailable_not_zero_sharpe(self):
        self.assertIsNone(rr.annualized_metrics([.01,.01,.01],risk_free_annual=.04)['sharpe'])
        self.assertIsNone(rr.annualized_metrics([.01])['volatility'])

    def test_frequency_and_cagr_distinction(self):
        r=[-.02,.01,.03,-.01]
        daily=rr.annualized_metrics(r,periods_per_year=252)
        weekly=rr.annualized_metrics(r,periods_per_year=52)
        crypto=rr.annualized_metrics(r,periods_per_year=365)
        self.assertAlmostEqual(crypto['volatility']/daily['volatility'],math.sqrt(365/252))
        self.assertAlmostEqual(weekly['volatility']/daily['volatility'],math.sqrt(52/252))
        self.assertAlmostEqual(rr.cagr(100,110,365.25),.10)
        self.assertNotAlmostEqual(rr.cagr(100,110,365.25),statistics.mean(r)*252)
        self.assertIsNone(rr.cagr(0,110,365))

    def test_ingestion_quarantines_only_corrupt_rows(self):
        rows=[
            {'symbol':'A','date':'2026-01-02','close':100.0,'adjClose':100.0},
            {'symbol':'A','date':'2026-01-02','close':100.0,'adjClose':100.0},
            {'symbol':'A','date':'2026-01-05','close':101.0,'adjClose':float('nan')},
            {'symbol':'A','date':'2026-01-06','close':102.0},
            {'symbol':'B','date':'2026-01-02','close':0.0},
            {'symbol':'B','date':'2026-01-05','close':50.0},
            {'symbol':'B','date':'2026-01-06','close':55.0},
            {'symbol':'C','date':'2026-01-05','close':10.0},
            {'symbol':'C','date':'2026-01-05','close':20.0},
            {'symbol':'C','date':'2026-01-06','close':22.0},
            {'symbol':'D','date':'2026-01-05','close':10.0},
            {'symbol':'D','date':'2026-01-06','close':25.0}
        ]
        cleaned,q=rr.validate_market_history(rows)
        self.assertEqual(len(cleaned),7)
        self.assertEqual(q['invalidPricePoints'],1)
        self.assertEqual(q['invalidAdjustedPoints'],1)
        self.assertEqual(q['duplicateDates'],2)
        self.assertEqual(q['conflictingDates'],1)
        self.assertIn('D',q['suspiciousMoveSymbols'])
        self.assertEqual([x['date'] for x in cleaned if x['symbol']=='C'],['2026-01-06'])
        self.assertEqual([x['date'] for x in cleaned if x['symbol']=='A'],
                         ['2026-01-02','2026-01-05','2026-01-06'])
        self.assertNotIn('adjClose',next(x for x in cleaned if x['symbol']=='A' and x['date']=='2026-01-05'))

    def test_javascript_and_python_annualisation_agree(self):
        if not shutil.which('node'):
            self.skipTest('Node is unavailable')
        html=(ROOT/'terminal_template.html').read_text()
        start=html.index('function annualizedRiskMetrics(')
        end=html.index('function watchReturns(',start)
        code=html[start:end]+'''
const xs=[-.02,.01,.03,-.01];
console.log(JSON.stringify([annualizedRiskMetrics(xs,252,null),
                            annualizedRiskMetrics(xs,252,.0425),
                            annualizedRiskMetrics([.01,.01,.01],252,.0425)]));
'''
        rows=json.loads(subprocess.check_output(['node','-e',code],text=True))
        py=rr.annualized_metrics([-.02,.01,.03,-.01])
        with_rf=rr.annualized_metrics([-.02,.01,.03,-.01],risk_free_annual=.0425)
        self.assertAlmostEqual(rows[0]['volatility']/100,py['volatility'])
        self.assertAlmostEqual(rows[1]['sharpe'],with_rf['sharpe'])
        self.assertIsNone(rows[0]['sharpe'])
        self.assertIsNone(rows[2]['sharpe'])


if __name__=='__main__':
    unittest.main()
