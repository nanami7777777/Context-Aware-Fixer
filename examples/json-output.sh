#!/bin/bash
# JSON output for scripting / CI integration
contextfix analyze "connection timeout in database module" --json | jq '.candidates[0]'
