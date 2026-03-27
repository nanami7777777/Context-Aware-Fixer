#!/bin/bash
# Use a custom OpenAI-compatible endpoint (e.g. DashScope, Azure, local proxy)
export OPENAI_API_KEY="your-api-key"

contextfix fix "NullPointerException in UserService.java:88" \
  --model openai:kimi-k2.5 \
  --base-url https://coding.dashscope.aliyuncs.com/v1
