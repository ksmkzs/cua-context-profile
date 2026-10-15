"""On-device tests for Windows process transport and fail-closed routing."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

def main():
    if sys.platform != 'win32':
        print('SKIP: Windows launcher tests require Windows')
        return
    here=Path(__file__).resolve().parent
    compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    node=shutil.which('node')
    if not node: raise SystemExit('Node is required')
    with tempfile.TemporaryDirectory(prefix='cua-profile-test-') as tmp:
        root=Path(tmp)
        guard=root/'guard'; guard.write_bytes(b'original')
        fixture=root/'fixture with spaces.cjs'
        fixture.write_text('let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{console.log(JSON.stringify({args:process.argv.slice(2),input:s,dirs:process.env.NODE_REPL_NODE_MODULE_DIRS,policy:process.env.CUA_TEST_POLICY}));console.error("child stderr");process.exitCode=17;});',encoding='utf8')
        m={'original_node_repl':node,'upstream_root':str(root),'sha256':{'guard':hashlib.sha256(b'original').hexdigest()}}
        (root/'manifest.json').write_text(json.dumps(m),encoding='utf8')
        wrapper=root/'node-repl.exe'
        subprocess.run([str(compiler),'/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+str(wrapper),str(here/'windows-wrapper.cs')],check=True)
        args=['', 'with space', 'quote"value', 'trailing\\', 'quote\\"value', '\u65e5\u672c\u8a9e']
        env={**os.environ,'NODE_REPL_NODE_MODULE_DIRS':'existing;second','CUA_TEST_POLICY':'preserved'}
        env.pop('CUA_REPL_ENABLED_SURFACES',None)
        env.pop('NODE_REPL_NODE_PATH',None)
        for label,enabled,changed in [('ordinary',False,False),('cua',True,False),('changed',True,True),('missing',True,True)]:
            if enabled: env['CUA_REPL_ENABLED_SURFACES']='computer'
            if changed: guard.write_bytes(b'changed')
            if label=='missing': guard.unlink()
            # Binary input avoids Python's Windows newline conversion; test the
            # launcher's transport rather than subprocess universal-newline mode.
            p=subprocess.run([str(wrapper),str(fixture),*args],input=b'stdin payload\n',capture_output=True,env=env)
            assert p.returncode==17,(label,p.returncode,p.stderr)
            data=json.loads(p.stdout)
            assert data['args']==args,(label,data['args'])
            assert data['input']=='stdin payload\n' and data['policy']=='preserved',(label,data)
            expected=str(root/'node_modules')+';existing;second' if enabled and not changed else 'existing;second'
            assert data['dirs']==expected,(label,data['dirs'])
            assert b'child stderr' in p.stderr
            assert (b'upstream changed' in p.stderr)==changed
        # A Store update can remove the old app directory. Follow the host's
        # current bundled Node sibling and disable the old documentation overlay.
        current=root/'new-runtime'; (current/'bin').mkdir(parents=True)
        shutil.copyfile(node,current/'bin/node_repl.exe')
        (current/'manifest.json').write_bytes(b'new version')
        guard.write_bytes(b'original')
        m['original_node_repl']=str(root/'removed-version/node_repl.exe')
        m['runtime_manifest_sha256']=hashlib.sha256(b'old version').hexdigest()
        (root/'manifest.json').write_text(json.dumps(m),encoding='utf8')
        env['NODE_REPL_NODE_PATH']=str(current/'bin/node.exe')
        p=subprocess.run([str(wrapper),str(fixture)],input=b'new runtime',capture_output=True,env=env)
        assert p.returncode==17,p.stderr
        assert json.loads(p.stdout)['dirs']=='existing;second'
        assert b'upstream changed' in p.stderr
        print('PASS: Windows argument quoting, inherited streams, exit codes, environment, selective routing, changed/missing guard fallback')
        print('PASS: Windows Store runtime relocation and version-change fallback')

if __name__=='__main__': main()
