"""Build Lambda archive locally. Does not access AWS or the network."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
build = root / 'infra/aws/build'
build.mkdir(parents=True, exist_ok=True)
with ZipFile(build / 'axolotl-api.zip', 'w', ZIP_DEFLATED) as archive:
    archive.write(root / 'backend/nce_api/handler.py', 'handler.py')
    archive.write(root / 'backend/nce_api/accounts.py', 'accounts.py')
    archive.write(root / 'backend/nce_api/games.py', 'games.py')
    archive.write(root / 'backend/nce_api/game_scores.py', 'game_scores.py')
    archive.write(root / 'backend/nce_api/feedback.py', 'feedback.py')
    archive.write(root / 'backend/nce_api/agent_framework.py', 'agent_framework.py')
    archive.write(root / 'config/agent-framework.json', 'agent-framework.json')
    archive.write(root / 'config/feedback-architecture.json', 'feedback-architecture.json')
print(build / 'axolotl-api.zip')
