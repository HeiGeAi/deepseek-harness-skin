"""Exercise the actual installer against synthetic hosts, never user installs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class InstallerTests(unittest.TestCase):
    def test_transaction_matrix(self):
        for git in (False, True, 'parent'):
            for mode in ('install', 'upgrade', 'incompatible', 'copy-failure', 'patch-failure', 'native-install', 'native-upgrade', 'native-incompatible', 'native-copy-failure', 'native-patch-failure'):
                with self.subTest(git=git, mode=mode), tempfile.TemporaryDirectory() as tmp:
                    native = mode.startswith('native-')
                    mode = mode.removeprefix('native-')
                    if native and not shutil.which('rsync'): self.skipTest('native rsync unavailable')
                    root=Path(tmp); package=root/'package'; host=root/'host'; home=root/'home'; bins=root/'bin'
                    for p in (package/'scripts', package/'patches', package/'tree/packages/client/ui-theme', host/'packages/client/ui-theme', home, bins): p.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT/'scripts/install.sh', package/'scripts/install.sh')
                    (package/'scripts/patched-files.txt').write_text('host.txt\n')
                    (package/'patches/host-integration.patch').write_text('--- a/host.txt\n+++ b/host.txt\n@@ -1 +1 @@\n-old\n+new\n')
                    (package/'tree/packages/client/ui-theme/new.txt').write_text('new theme')
                    (host/'package.json').write_text('{"name":"@deepseek-ai/dsh-root"}')
                    (host/'host.txt').write_text('new\n' if mode=='upgrade' else 'incompatible\n' if mode=='incompatible' else 'old\n')
                    (host/'packages/client/ui-theme/original.txt').write_text('original theme')
                    if mode=='upgrade': (host/'packages/client/ui-theme/src').mkdir();(host/'packages/client/ui-theme/src/skin-version.ts').write_text('v1')
                    if git: subprocess.run(['git','init','-q',str(root if git == 'parent' else host)],check=True)
                    # Deterministic rsync stand-in permits failure-after-partial-copy injection.
                    rsync=bins/'rsync'
                    rsync.write_text('''#!/usr/bin/env python3
import os, pathlib, shutil, sys
src,dst=map(pathlib.Path,sys.argv[-2:])
shutil.rmtree(dst);shutil.copytree(src,dst)
flag=pathlib.Path(os.environ['FAIL_FLAG'])
if os.environ.get('FAIL_COPY')=='1' and not flag.exists():
 flag.touch();sys.exit(1)
''');rsync.chmod(0o755)
                    if native:
                        if mode == 'copy-failure':
                            actual_rsync = shutil.which('rsync')
                            rsync.write_text('#!/usr/bin/env python3\nimport os,pathlib,subprocess,sys\n' +
                                f'subprocess.run([{actual_rsync!r}]+sys.argv[1:],check=True)\n' +
                                "flag=pathlib.Path(os.environ['FAIL_FLAG'])\nif not flag.exists():\n flag.touch();sys.exit(1)\n")
                            rsync.chmod(0o755)
                        else:
                            rsync.unlink()
                    if mode == 'patch-failure':
                        tool = 'git' if git is True else 'patch'
                        actual = shutil.which(tool)
                        wrapper = bins/tool
                        wrapper.write_text('#!/usr/bin/env python3\nimport os,sys,pathlib\na=sys.argv[1:]\n' +
                            "if ('apply' in a or sys.argv[0].endswith('/patch')) and '--check' not in a and '--dry-run' not in a:\n pathlib.Path('host.txt').write_text('partial')\n sys.exit(1)\n" +
                            f'os.execv({actual!r}, [{actual!r}]+a)\n')
                        wrapper.chmod(0o755)
                    snapshot=lambda:{str(p.relative_to(host)):p.read_bytes() for p in host.rglob('*') if p.is_file() and '.git' not in p.parts}
                    before=snapshot()
                    env={**os.environ,'HOME':str(home),'PATH':str(bins)+os.pathsep+os.environ['PATH'],'FAIL_FLAG':str(root/'failed'),'FAIL_COPY':'1' if mode=='copy-failure' else '0'}
                    result=subprocess.run(['bash',str(package/'scripts/install.sh'),str(host)],env=env,capture_output=True,text=True)
                    if mode in ('incompatible','copy-failure','patch-failure'):
                        self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
                        self.assertEqual(snapshot(),before)
                    else:
                        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                        self.assertEqual((host/'host.txt').read_text(),'new\n')
                        self.assertTrue((host/'packages/client/ui-theme/new.txt').exists())

if __name__=='__main__':unittest.main()
