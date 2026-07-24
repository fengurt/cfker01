-- Correct the canonical repository for MCP-managed skills.
UPDATE mcp_skill_drafts
SET target_repo = 'fengurt/cfker01'
WHERE target_repo = 'fengurt/ksacloudf01';
