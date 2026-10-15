#!/usr/bin/env python3
"""Set or restore the current Windows user's desktop runtime override."""
import argparse
import ctypes
import json
from pathlib import Path
import sys

def main():
    if sys.platform != 'win32': raise SystemExit('Run on Windows')
    import winreg
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dest',type=Path,default=Path.home()/'.codex/cua-context-profile')
    p.add_argument('--restore',action='store_true')
    a=p.parse_args()
    root=a.dest.expanduser().resolve()
    m=json.loads((root/'manifest.json').read_text(encoding='utf8'))
    wrapper=str(root/'node-repl.exe')
    if not Path(wrapper).is_file(): raise SystemExit('Prepare the profile first')
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,'Environment') as key:
        try: current,kind=winreg.QueryValueEx(key,'CODEX_NODE_REPL_PATH')
        except FileNotFoundError: current=None; kind=winreg.REG_SZ
        if kind!=winreg.REG_SZ or current not in (None,'',wrapper):
            raise SystemExit('Another override is configured; preserving it')
        value=m['previous_user_override'] if a.restore else wrapper
        if value is None:
            try: winreg.DeleteValue(key,'CODEX_NODE_REPL_PATH')
            except FileNotFoundError: pass
        else: winreg.SetValueEx(key,'CODEX_NODE_REPL_PATH',0,winreg.REG_SZ,value)
    result=ctypes.c_size_t()
    send=ctypes.windll.user32.SendMessageTimeoutW
    send.argtypes=[ctypes.c_void_p,ctypes.c_uint,ctypes.c_size_t,ctypes.c_wchar_p,ctypes.c_uint,ctypes.c_uint,ctypes.POINTER(ctypes.c_size_t)]
    send.restype=ctypes.c_void_p
    notified=send(0xffff,0x001a,0,'Environment',2,5000,ctypes.byref(result))
    print(json.dumps({'restored':a.restore,'user_override':value,'environment_change_notified':bool(notified),
                      'restart_required':True}))

if __name__=='__main__': main()
