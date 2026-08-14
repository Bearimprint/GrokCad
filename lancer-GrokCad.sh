#!/usr/bin/env bash
# =============================================================================
# lancer-GrokCad.sh — Démarre GrokCAD et ouvre le navigateur par défaut
# =============================================================================
# Double-clic depuis le gestionnaire de fichiers OU :
#   ./lancer-GrokCad.sh
# =============================================================================

set -euo pipefail

# Chemin absolu du script (même si lancé depuis un autre dossier)
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_DIR="$(dirname "$SCRIPT_PATH")"
PORT=5173
URL="http://localhost:${PORT}"

# Node.js local (hors PATH quand on double-clique depuis le bureau)
export PATH="${HOME}/.local/node/bin:${HOME}/.local/bin:${HOME}/.grok/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# --- Relance dans un terminal si double-clic (pas de TTY) -------------------
# « Lancer » sans terminal ne peut pas garder le serveur Vite vivant correctement
# et n’affiche aucune erreur. On force donc une fenêtre terminal.
if [[ "${1:-}" != "--in-terminal" ]] && [[ ! -t 1 ]]; then
  TITLE="GrokCAD"
  RUN_CMD="bash $(printf '%q' "$SCRIPT_PATH") --in-terminal; echo; read -r -p 'Appuyez sur Entrée pour fermer… '"

  if command -v gnome-terminal >/dev/null 2>&1; then
    exec gnome-terminal --title="$TITLE" --working-directory="$PROJECT_DIR" -- bash -c "$RUN_CMD"
  elif command -v xfce4-terminal >/dev/null 2>&1; then
    exec xfce4-terminal --title="$TITLE" --working-directory="$PROJECT_DIR" -e "bash -c $(printf '%q' "$RUN_CMD")"
  elif command -v x-terminal-emulator >/dev/null 2>&1; then
    exec x-terminal-emulator -T "$TITLE" -e bash -c "$RUN_CMD"
  elif command -v xterm >/dev/null 2>&1; then
    exec xterm -T "$TITLE" -e bash -c "$RUN_CMD"
  else
    # Dernier recours : essayer quand même sans terminal
    echo "Aucun émulateur de terminal trouvé — démarrage en arrière-plan."
  fi
fi

cd "$PROJECT_DIR"

# --- Ouvre l’URL dans le navigateur web par défaut --------------------------
open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v gio >/dev/null 2>&1; then
    gio open "$URL" >/dev/null 2>&1 &
  elif command -v firefox >/dev/null 2>&1; then
    firefox --new-window "$URL" >/dev/null 2>&1 &
  elif command -v google-chrome >/dev/null 2>&1; then
    google-chrome --new-window "$URL" >/dev/null 2>&1 &
  elif command -v chromium-browser >/dev/null 2>&1; then
    chromium-browser --new-window "$URL" >/dev/null 2>&1 &
  else
    echo "Navigateur introuvable. Ouvrez manuellement : $URL"
    return 1
  fi
}

# --- Teste si le serveur Vite répond déjà -----------------------------------
is_server_up() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf -o /dev/null --connect-timeout 1 "$URL" 2>/dev/null
    return $?
  fi
  (echo >/dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1
}

# --- Déjà en cours : on ouvre juste le navigateur ---------------------------
if is_server_up; then
  echo "GrokCAD est déjà lancé → ouverture de $URL"
  open_browser
  # Si on est dans un terminal ouvert par double-clic, ne pas le laisser vide
  if [[ "${1:-}" == "--in-terminal" ]]; then
    echo "Le serveur tourne déjà. Vous pouvez fermer cette fenêtre."
    read -r -p "Appuyez sur Entrée pour fermer… "
  fi
  exit 0
fi

# --- Prérequis Node / npm ---------------------------------------------------
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Erreur : Node.js / npm introuvables."
  echo "Cherché dans : ${HOME}/.local/node/bin et le PATH système."
  echo "Installez Node.js ou placez-le dans ~/.local/node/bin"
  exit 1
fi

echo "Node $(node -v) · npm $(npm -v)"

if [[ ! -d node_modules ]]; then
  echo "Installation des dépendances (première fois)…"
  npm install
fi

# --- Attend que le serveur soit prêt, puis ouvre le navigateur --------------
(
  for _ in $(seq 1 80); do
    if is_server_up; then
      echo "Serveur prêt → ouverture de $URL"
      open_browser
      exit 0
    fi
    sleep 0.25
  done
  echo "Le serveur met trop de temps à démarrer. Ouvrez manuellement : $URL"
) &

echo "Démarrage de GrokCAD sur $URL …"
echo "(Ctrl+C pour arrêter le serveur)"
echo

# Vite : port 5173 (vite.config.ts)
exec npm run dev -- --host 127.0.0.1 --port "$PORT"
