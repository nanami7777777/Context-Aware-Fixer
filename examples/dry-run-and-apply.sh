#!/bin/bash
# Preview the patch first (dry-run), then apply if it looks good

# Step 1: Preview
contextfix fix "IndexError: list index out of range in data_processor.py:23" --dry-run

# Step 2: Apply (uncomment when ready)
# contextfix fix "IndexError: list index out of range in data_processor.py:23" --apply
