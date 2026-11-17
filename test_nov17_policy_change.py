"""Regression: policy rate prior means the last distinct policy decision, not yesterday."""
import pathlib
import tempfile
from economic_forecasts import collect

with tempfile.TemporaryDirectory() as directory:
    forecasts=pathlib.Path(directory)/'consensus.csv'
    macros=[
      {'key':'uk_policy','region':'UK','name':'Bank of England Bank Rate',
       'frequency':'policy','unit':'%','source':'Official synthetic fixture',
       'history':[{'date':'2026-11-03','value':3.75},
                  {'date':'2026-11-04','value':3.75},
                  {'date':'2026-11-05','value':4.0},
                  {'date':'2026-11-06','value':4.0},
                  {'date':'2026-11-13','value':4.0},
                  {'date':'2026-11-16','value':4.0}]},
      {'key':'uk_cpi','region':'UK','name':'CPI','frequency':'monthly',
       'unit':'%','source':'Synthetic','history':[
          {'date':'2026-08-01','value':3.1},{'date':'2026-09-01','value':3.5}]}
    ]
    rows,warnings,count=collect(macros,forecasts)
    policy=next(x for x in rows if x['key']=='uk_policy')
    assert policy['value']==4.0, policy
    assert policy['previous']==3.75,policy
    assert policy['policyChangeDate']=='2026-11-05',policy
    assert policy['policyChangeBp']==25.0,policy
    cpi=next(x for x in rows if x['key']=='uk_cpi')
    assert cpi['previous']==3.1 and 'policyChangeBp' not in cpi,cpi
    flat=[{'key':'flat_policy','frequency':'policy','history':[
       {'date':'2026-11-13','value':4.0},{'date':'2026-11-16','value':4.0}]}]
    blank,_,_=collect(flat,forecasts)
    assert blank[0]['previous'] is None and blank[0]['policyChangeDate'] is None
print('PASS: distinct policy rates, policy change dates, CPI ordinary prior, no fabricated changes')
