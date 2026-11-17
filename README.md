# Global Market Terminal (Terminal 3)

Static site built by GitHub Actions and published to GitHub Pages.

- `build_site.py` is the single build entry point (build, verify, post-process, inject layout).
- `run_tests.py` runs every `test_*.py` before each publish.
- `data_freshness.js` draws the per-source age strip in the page header.
- `seed_site.py` names the older Terminal 2 site that seeds empty caches. Set
  `MT_SEED_PAGES=none` in `.github/workflows/publish.yml` to retire it.
- `docs/` holds release notes and old change logs.
