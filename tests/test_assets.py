import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]/'tree/packages/client/ui-theme'
class AssetTests(unittest.TestCase):
    def test_asset_validation_is_read_only(self):
        for mode in ('valid','missing','unsafe'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                target=Path(tmp)/'theme';shutil.copytree(ROOT,target)
                themes=target/'src/styles/skins/themes'
                selected=next(p for p in themes.glob('*.json') if json.loads(p.read_text()).get('hero'))
                theme=json.loads(selected.read_text())
                if mode=='missing':(target/'src/styles/skins/assets'/theme['hero']).unlink()
                if mode=='unsafe':theme['hero']='../outside.webp';selected.write_text(json.dumps(theme))
                snapshot=lambda:{str(p.relative_to(target)):p.read_bytes() for p in target.rglob('*') if p.is_file()}
                before=snapshot()
                result=subprocess.run(['node','--experimental-strip-types','scripts/build-skins.mjs','--check'],cwd=target,capture_output=True,text=True)
                self.assertEqual(result.returncode,0 if mode=='valid' else 1,result.stdout+result.stderr)
                self.assertEqual(snapshot(),before)
                if mode!='valid':self.assertIn(theme['id'],result.stderr)
if __name__=='__main__':unittest.main()
