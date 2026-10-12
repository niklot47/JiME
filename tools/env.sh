# Source at the start of every Claude session on the PC (Linux VM of the Claude workspace)
export JIME_ROOT="$HOME/mnt/JiME_Claude"
export JIME_WORK="$JIME_ROOT/data"
# Game data: either the whole game folder or just JiME_Data may be connected
if [ -d "$HOME/mnt/JiME_Data" ]; then export JIME_DATA="$HOME/mnt/JiME_Data"; else export JIME_DATA="$HOME/mnt/Journeys in Middle-earth/JiME_Data"; fi
export JIME_MANAGED="$JIME_DATA/Managed"
cd "$JIME_ROOT"
python3 -c "import UnityPy, dnfile, TypeTreeGeneratorAPI, attrs, PIL, numpy" 2>/dev/null || pip install --user -q --ignore-installed -r "$JIME_ROOT/tools/importer/requirements.txt"
echo "JiME env ready: WORK=$JIME_WORK"
