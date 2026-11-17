"""The one place that names the older Terminal 2 site used to seed empty caches.

A new repository has no accumulated history, so several modules start from a
published copy and then overlay their own newer data. They used to hard-code the
older site in seven places. Now they ask here.

    MT_SEED_PAGES   base URL of the seed site, with trailing slash
                    (default: the Terminal 2 site)
    MT_SEED_PAGES=none   switch seeding off once this repo holds its own history

Set the variable in the workflow's env block; no code change is needed to retire
Terminal 2.
"""
import os

DEFAULT = 'https://rs88pvyhzz-code.github.io/Market-terminal-2/'


def base():
    value = os.environ.get('MT_SEED_PAGES', DEFAULT).strip()
    if value.lower() in ('', 'none', 'off', '0'):
        return None
    return value if value.endswith('/') else value + '/'


def url(filename=''):
    root = base()
    return root + filename if root else None


def ordered(seed, *own):
    """Seed first, then the repository's own copies (which overlay it). None is dropped."""
    return tuple(u for u in (seed, *own) if u)
