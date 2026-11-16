"""Persist actual source responses with original timestamps, never test fixtures.

The checked-in recovery archive contains real responses collected 9 November.
Newer runner/Pages cache entries always win. No market values are embedded in code.
"""
import gzip
import hashlib
import json
import os
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parent
NAME='primary_source_archive.json.gz'
PREFIXES=('.terminal_filings/','.terminal_research/documents/')
MAX_SIZE=350_000_000

def pack(root=ROOT):
    entries={}
    for prefix in PREFIXES:
        for f in (Path(root)/prefix).glob('*.json'):
            try:raw=f.read_text();json.loads(raw)
            except (OSError,ValueError):continue
            entries[str(f.relative_to(root))]={'sha256':hashlib.sha256(raw.encode()).hexdigest(),'content':raw}
    return gzip.compress(json.dumps({'schema':1,'entries':entries},separators=(',',':')).encode(),mtime=0)

def restore_bytes(blob,root=ROOT):
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(blob)) as z:raw=z.read(MAX_SIZE+1)
    if len(raw)>MAX_SIZE:raise ValueError('Source archive exceeds bound')
    data=json.loads(raw);count=0
    for name,entry in data['entries'].items():
        if not name.startswith(PREFIXES) or '..' in Path(name).parts or not name.endswith('.json'):raise ValueError('Unsafe archive path')
        content=entry['content']
        if hashlib.sha256(content.encode()).hexdigest()!=entry['sha256']:raise ValueError('Source hash mismatch')
        incoming=json.loads(content);target=Path(root)/name
        def stamp(d):
            # Supplement has independent verified balance/capital dates; merge below.
            return str(d.get('retrievedAt') or '')
        try:old=json.loads(target.read_text())
        except (OSError,ValueError):old={}
        if name.endswith('shell_supplemental.json') and old:
            merged={**incoming,**old};merged['documents']={**incoming.get('documents',{}),**old.get('documents',{})}
            for key,date in [('balance','period'),('capital','sharesPeriod')]:
                a=incoming.get(key) or {};b=old.get(key) or {}
                merged[key]=a if (a.get(date,''),stamp(a))>(b.get(date,''),stamp(b)) else b or a
            content=json.dumps(merged,separators=(',',':'))
        elif old and stamp(old)>=stamp(incoming):continue
        target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content);count+=1
    return count

def restore(root=ROOT,published=True):
    root=Path(root);count=0
    seed=root/'verified_sources'/NAME
    if seed.exists():
        try:count+=restore_bytes(seed.read_bytes(),root)
        except (OSError,ValueError,KeyError) as exc:print('Recovery archive unavailable; existing cache retained: '+str(exc)[:100],flush=True)
    repo=os.environ.get('GITHUB_REPOSITORY','')
    if published and '/' in repo:
        owner,name=repo.split('/',1)
        sibling=f'https://{owner}.github.io/Market-terminal-2/{NAME}'
        current=f'https://{owner}.github.io/{name}/{NAME}'
        urls=(sibling,current) if name.lower()=='market-terminal-3' else (current,)
        # The full primary-document archive is larger than the former 12 MB cap.
        # Its decompressed size, document paths and hashes remain verified by restore_bytes.
        compressed_limit=80_000_000
        for url in urls:
            try:
                req=urllib.request.Request(url,headers={'User-Agent':'MarketTerminal/2.1',
                                                        'Cache-Control':'no-cache'})
                with urllib.request.urlopen(req,timeout=35) as r:blob=r.read(compressed_limit+1)
                if len(blob)>compressed_limit:raise ValueError('Compressed source archive exceeds bound')
                restored=restore_bytes(blob,root);count+=restored
                print('Verified source archive: restored '+str(restored)+' files from '+url,flush=True)
            except Exception as exc:
                print('Published source archive unavailable: '+url+' ('+str(exc)[:100]+')',flush=True)
    return count

def publish(root=ROOT):
    path=Path(root)/'public'/NAME;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(pack(root))

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('action',choices=['restore','publish']);a=p.parse_args()
    if a.action=='restore':print('Restored actual source responses:',restore())
    else:publish()
