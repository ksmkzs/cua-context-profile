#!/usr/bin/env python3
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import hashlib

with tempfile.TemporaryDirectory(prefix='cua-profile-test-') as tmp:
    root = Path(tmp).resolve()
    shutil.copyfile(Path(__file__).resolve().parent/'wrapper.py',root/'wrapper')
    (root/'wrapper').chmod(0o755)
    upstream = root/'upstream'; upstream.mkdir()
    (upstream/'guard').write_text('original')
    fake = root/'fake'
    fake.write_text('#!/usr/bin/python3\nimport os,json\nprint(json.dumps({"dirs":os.environ.get("NODE_REPL_NODE_MODULE_DIRS"),"policy":os.environ.get("TEST_POLICY_SENTINEL")}))\n')
    fake.chmod(0o755)
    manifest = {'upstream_root':str(upstream),'sha256':{'guard':hashlib.sha256(b'original').hexdigest()},'original_node_repl':str(fake)}
    (root/'manifest.json').write_text(json.dumps(manifest))
    env={'PATH':'/usr/bin:/bin','NODE_REPL_NODE_MODULE_DIRS':'/original/modules','TEST_POLICY_SENTINEL':'untouched'}
    def call():
        result=subprocess.run([str(root/'wrapper')],env=env,capture_output=True,text=True,check=True)
        value=json.loads(result.stdout)
        assert value['policy']=='untouched'
        return value['dirs'],result.stderr
    assert call()[0]=='/original/modules'  # Other Node REPL use is unchanged.
    env['CUA_REPL_ENABLED_SURFACES']='computer'
    assert call()[0]==str(root/'node_modules')+':/original/modules'
    (upstream/'guard').write_text('updated')
    dirs,warning=call()
    assert dirs=='/original/modules' and 'upstream changed' in warning
print('PASS: selective routing, environment preservation, upstream-change fallback')
