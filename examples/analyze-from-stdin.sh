#!/bin/bash
# Pipe a stack trace from a log file into contextfix
cat <<'EOF' | contextfix analyze
TypeError: Cannot read properties of undefined (reading 'name')
    at processUser (/home/dev/project/src/services/user.ts:42:10)
    at handleRequest (/home/dev/project/src/routes/api.ts:15:3)
    at Layer.handle (/home/dev/project/node_modules/express/lib/router/layer.js:95:5)
EOF
