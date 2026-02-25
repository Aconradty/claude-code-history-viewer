use super::ProviderInfo;
use crate::models::{ClaudeMessage, ClaudeProject, ClaudeSession, TokenUsage};
use crate::utils::{is_safe_storage_id, search_json_value_case_insensitive};
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::path::{Path, PathBuf};

// ============================================================================
// Provider detection
// ============================================================================

/// Detect Cursor AI installation.
pub fn detect() -> Option<ProviderInfo> {
    let base_path = get_base_path()?;
    let global_db = Path::new(&base_path)
        .join("globalStorage")
        .join("state.vscdb");

    Some(ProviderInfo {
        id: "cursor".to_string(),
        display_name: "Cursor AI".to_string(),
        base_path: base_path.clone(),
        is_available: global_db.exists() && global_db.is_file(),
    })
}

/// Get the Cursor User data path.
///
/// Checks `$CURSOR_DATA_HOME` first (for testing), then falls back to
/// platform defaults:
/// - macOS: `~/Library/Application Support/Cursor/User`
/// - Linux: `~/.config/Cursor/User`
/// - Windows: `{config_dir}/Cursor/User`
pub fn get_base_path() -> Option<String> {
    if let Ok(custom) = std::env::var("CURSOR_DATA_HOME") {
        let p = PathBuf::from(&custom);
        if p.exists() {
            return Some(custom);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()?;
        let candidate = home
            .join("Library")
            .join("Application Support")
            .join("Cursor")
            .join("User");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    #[cfg(target_os = "linux")]
    {
        let home = dirs::home_dir()?;
        let candidate = home.join(".config").join("Cursor").join("User");
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(config) = dirs::config_dir() {
            let candidate = config.join("Cursor").join("User");
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    None
}

// ============================================================================
// SQLite helpers
// ============================================================================

/// Open an `SQLite` database in read-only mode.
fn open_db(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open database {}: {e}", path.display()))
}

/// Query a text value from the `ItemTable` by key.
fn query_item_table(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM ItemTable WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let val: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(val))
    } else {
        Ok(None)
    }
}

/// Query a text value from the `cursorDiskKV` table by key.
fn query_cursor_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM cursorDiskKV WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let val: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(val))
    } else {
        Ok(None)
    }
}

// ============================================================================
// Workspace discovery
// ============================================================================

/// Represents one Cursor workspace that maps a hash directory to a project folder.
struct WorkspaceInfo {
    hash: String,
    folder_path: String,
    composer_ids: Vec<String>,
}

/// Validate UUID format (8-4-4-4-12 hex chars).
fn is_valid_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    s.chars().enumerate().all(|(i, c)| match i {
        8 | 13 | 18 | 23 => c == '-',
        _ => c.is_ascii_hexdigit(),
    })
}

/// Walk all workspaces under `{base}/workspaceStorage/` and extract the
/// folder path + associated composer IDs.
fn discover_workspaces(base_path: &str) -> Result<Vec<WorkspaceInfo>, String> {
    let ws_root = Path::new(base_path).join("workspaceStorage");
    if !ws_root.exists() {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&ws_root).map_err(|e| e.to_string())?;
    let mut workspaces = Vec::new();

    for entry in entries.filter_map(Result::ok) {
        // Block symlinks during directory traversal
        if entry.file_type().map_or(true, |ft| ft.is_symlink()) {
            continue;
        }

        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let hash = match dir_path.file_name().and_then(|n| n.to_str()) {
            Some(h) if is_safe_storage_id(h) => h.to_string(),
            _ => continue,
        };

        // Read workspace.json to get the project folder
        let ws_json_path = dir_path.join("workspace.json");
        let folder_path = match read_workspace_folder(&ws_json_path) {
            Some(f) => f,
            None => continue,
        };

        // Read composer IDs from the workspace's state.vscdb
        let db_path = dir_path.join("state.vscdb");
        let composer_ids = if db_path.exists() {
            read_workspace_composer_ids(&db_path).unwrap_or_default()
        } else {
            Vec::new()
        };

        if !composer_ids.is_empty() {
            workspaces.push(WorkspaceInfo {
                hash,
                folder_path,
                composer_ids,
            });
        }
    }

    Ok(workspaces)
}

/// Parse `workspace.json` to extract the project folder path.
fn read_workspace_folder(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let val: Value = serde_json::from_str(&content).ok()?;
    let folder_uri = val.get("folder")?.as_str()?;
    Some(uri_to_path(folder_uri))
}

/// Strip `file://` prefix from a URI and decode percent-encoded chars.
fn uri_to_path(uri: &str) -> String {
    if let Some(stripped) = uri.strip_prefix("file://") {
        urlencoding::decode(stripped)
            .map(std::borrow::Cow::into_owned)
            .unwrap_or_else(|_| stripped.to_string())
    } else {
        uri.to_string()
    }
}

/// Read composer IDs from a workspace's `state.vscdb`.
fn read_workspace_composer_ids(db_path: &Path) -> Result<Vec<String>, String> {
    let conn = open_db(db_path)?;
    let raw = match query_item_table(&conn, "composer.composerData")? {
        Some(v) => v,
        None => return Ok(Vec::new()),
    };
    let val: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let composers = val
        .get("allComposers")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let id = c.get("composerId").and_then(Value::as_str)?;
                    if is_valid_uuid(id) {
                        Some(id.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(composers)
}

// ============================================================================
// Composer metadata
// ============================================================================

/// Summary metadata extracted from a composerData entry.
struct ComposerMeta {
    name: Option<String>,
    created_at: Option<i64>,
    last_updated_at: Option<i64>,
    message_count: usize,
    has_tool_use: bool,
    status: Option<String>,
}

/// Extract lightweight metadata from a `composerData:{id}` JSON blob.
fn extract_composer_meta(val: &Value) -> ComposerMeta {
    let name = val.get("name").and_then(Value::as_str).map(String::from);
    let created_at = val.get("createdAt").and_then(Value::as_i64);
    let last_updated_at = val.get("lastUpdatedAt").and_then(Value::as_i64);
    let status = val.get("status").and_then(Value::as_str).map(String::from);

    // Count messages: either inline `conversation` or `fullConversationHeadersOnly`
    let message_count = val
        .get("conversation")
        .and_then(Value::as_array)
        .map(Vec::len)
        .or_else(|| {
            val.get("fullConversationHeadersOnly")
                .and_then(Value::as_array)
                .map(Vec::len)
        })
        .unwrap_or(0);

    // Check for tool use in inline conversations
    let has_tool_use = val
        .get("conversation")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .any(|m| m.get("toolFormerData").is_some() || m.get("capabilityType").is_some())
        })
        .unwrap_or(false);

    ComposerMeta {
        name,
        created_at,
        last_updated_at,
        message_count,
        has_tool_use,
        status,
    }
}

/// Read composer metadata from the global DB, returning `None` if not found.
fn read_composer_meta(
    conn: &Connection,
    composer_id: &str,
) -> Result<Option<ComposerMeta>, String> {
    let key = format!("composerData:{composer_id}");
    let raw = match query_cursor_kv(conn, &key)? {
        Some(v) => v,
        None => return Ok(None),
    };
    let val: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(Some(extract_composer_meta(&val)))
}

// ============================================================================
// Timestamp helpers
// ============================================================================

/// Format a millisecond epoch timestamp to RFC 3339.
fn millis_to_rfc3339(millis: i64) -> String {
    let secs = millis / 1000;
    let nsecs = ((millis % 1000) * 1_000_000) as u32;
    Utc.timestamp_opt(secs, nsecs)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

/// Convert epoch milliseconds (u64) to RFC 3339.
fn epoch_ms_to_rfc3339(ms: u64) -> Option<String> {
    #[allow(clippy::cast_possible_wrap)]
    let secs = (ms / 1000) as i64;
    let nsecs = ((ms % 1000) * 1_000_000) as u32;
    DateTime::from_timestamp(secs, nsecs).map(|dt| dt.to_rfc3339())
}

/// Extract a timestamp string from a bubble's `createdAt` field.
fn extract_timestamp(val: &Value) -> Option<String> {
    val.get("createdAt").and_then(|v| {
        if let Some(s) = v.as_str() {
            Some(s.to_string())
        } else if let Some(ms) = v.as_u64() {
            epoch_ms_to_rfc3339(ms)
        } else {
            v.as_i64().map(millis_to_rfc3339)
        }
    })
}

// ============================================================================
// Bubble → Message conversion
// ============================================================================

/// Normalize Cursor tool names to match the canonical Claude Code tool names
/// that the frontend renderers already handle.
fn normalize_cursor_tool_name(name: &str) -> &str {
    match name {
        "read_file" | "read_file_v2" => "Read",
        "edit_file" | "edit_file_v2" | "edit_file_v2_search_replace" | "search_replace" => "Edit",
        "edit_files" | "MultiEdit" | "apply_patch" => "MultiEdit",
        "write" => "Write",
        "run_terminal_cmd"
        | "run_terminal_command_v2"
        | "list_dir"
        | "list_dir_v2"
        | "delete_file" => "Bash",
        "codebase_search" | "grep_search" | "grep" | "rg" | "ripgrep" | "ripgrep_raw_search" => {
            "Grep"
        }
        "file_search" | "glob_file_search" => "Glob",
        "web_search" => "WebSearch",
        "web_fetch" => "WebFetch",
        "todo_write" => "TodoWrite",
        "ask_question" => "AskUserQuestion",
        other => other,
    }
}

/// Build a content array from a Cursor bubble in Claude-compatible format.
fn build_content_array(val: &Value, bubble_type: u64) -> Option<Value> {
    let mut items: Vec<Value> = Vec::new();

    // Thinking block (assistant only)
    if bubble_type == 2 {
        if let Some(text) = val
            .get("thinking")
            .and_then(|t| t.get("text"))
            .and_then(Value::as_str)
        {
            if !text.is_empty() {
                items.push(serde_json::json!({
                    "type": "thinking",
                    "thinking": text,
                }));
            }
        }
    }

    // Text content
    if let Some(text) = val.get("text").and_then(Value::as_str) {
        if !text.is_empty() {
            items.push(serde_json::json!({
                "type": "text",
                "text": text,
            }));
        }
    }

    // Tool use (assistant only, from toolFormerData)
    if bubble_type == 2 {
        if let Some(tfd) = val.get("toolFormerData").and_then(Value::as_object) {
            let tool_name = tfd.get("name").and_then(Value::as_str).unwrap_or("unknown");
            let tool_call_id = tfd.get("toolCallId").and_then(Value::as_str).unwrap_or("");
            let raw_args = tfd.get("rawArgs").and_then(Value::as_str).unwrap_or("{}");
            let input: Value =
                serde_json::from_str(raw_args).unwrap_or(Value::Object(serde_json::Map::default()));

            if !tool_call_id.is_empty() {
                items.push(serde_json::json!({
                    "type": "tool_use",
                    "id": tool_call_id,
                    "name": normalize_cursor_tool_name(tool_name),
                    "input": input,
                }));

                // Tool result from completed/error status
                let status = tfd.get("status").and_then(Value::as_str).unwrap_or("");
                if status == "completed" || status == "error" {
                    if let Some(params) = tfd.get("params").and_then(Value::as_str) {
                        let params_val: Value = serde_json::from_str(params).unwrap_or(Value::Null);
                        items.push(serde_json::json!({
                            "type": "tool_result",
                            "tool_use_id": tool_call_id,
                            "content": params_val,
                            "is_error": status == "error",
                        }));
                    }
                }
            }
        }
    }

    // Skip empty assistant capability-only bubbles (intermediate tool-execution
    // steps with no visible content)
    if items.is_empty() && val.get("capabilityType").is_some() {
        return None;
    }

    if items.is_empty() {
        None
    } else {
        Some(Value::Array(items))
    }
}

/// Convert a single Cursor bubble (message) JSON to a `ClaudeMessage`.
fn bubble_to_message(bubble: &Value, session_id: &str, msg_index: u64) -> Option<ClaudeMessage> {
    let bubble_type = bubble.get("type").and_then(Value::as_u64)?;
    let bubble_id = bubble
        .get("bubbleId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let (message_type, role) = match bubble_type {
        1 => ("user", "user"),
        2 => ("assistant", "assistant"),
        _ => return None,
    };

    let timestamp = extract_timestamp(bubble).unwrap_or_default();
    let content = build_content_array(bubble, bubble_type)?;

    // Extract model info
    let model = bubble
        .get("modelInfo")
        .and_then(|m| m.get("modelName"))
        .and_then(Value::as_str)
        .map(String::from);

    // Extract token usage
    let usage = bubble.get("tokenCount").and_then(|tc| {
        let input = tc
            .get("inputTokens")
            .and_then(Value::as_u64)
            .map(|v| v as u32);
        let output = tc
            .get("outputTokens")
            .and_then(Value::as_u64)
            .map(|v| v as u32);
        if input.is_some() || output.is_some() {
            Some(TokenUsage {
                input_tokens: input,
                output_tokens: output,
                cache_creation_input_tokens: None,
                cache_read_input_tokens: None,
                service_tier: None,
            })
        } else {
            None
        }
    });

    Some(ClaudeMessage {
        uuid: if bubble_id.is_empty() {
            format!("cursor-{session_id}-{msg_index}")
        } else {
            bubble_id
        },
        parent_uuid: None,
        session_id: session_id.to_string(),
        timestamp,
        message_type: message_type.to_string(),
        content: Some(content),
        project_name: None,
        tool_use: None,
        tool_use_result: None,
        is_sidechain: None,
        usage,
        role: Some(role.to_string()),
        model,
        stop_reason: None,
        cost_usd: None,
        duration_ms: bubble.get("thinkingDurationMs").and_then(Value::as_u64),
        message_id: None,
        snapshot: None,
        is_snapshot_update: None,
        data: None,
        tool_use_id: None,
        parent_tool_use_id: None,
        operation: None,
        subtype: None,
        level: None,
        hook_count: None,
        hook_infos: None,
        stop_reason_system: None,
        prevented_continuation: None,
        compact_metadata: None,
        microcompact_metadata: None,
        provider: Some("cursor".to_string()),
    })
}

// ============================================================================
// Public API: scan / load / search
// ============================================================================

/// Scan all Cursor workspaces and return them as projects.
pub fn scan_projects() -> Result<Vec<ClaudeProject>, String> {
    let base_path = get_base_path().ok_or_else(|| "Cursor not found".to_string())?;
    let workspaces = discover_workspaces(&base_path)?;

    if workspaces.is_empty() {
        return Ok(Vec::new());
    }

    let global_db_path = Path::new(&base_path)
        .join("globalStorage")
        .join("state.vscdb");
    let global_conn = open_db(&global_db_path)?;

    let mut projects: Vec<ClaudeProject> = Vec::new();

    for ws in &workspaces {
        let mut total_messages = 0usize;
        let mut latest_updated: i64 = 0;
        let mut has_any_content = false;

        for cid in &ws.composer_ids {
            if let Some(meta) = read_composer_meta(&global_conn, cid)? {
                if meta.message_count > 0 {
                    has_any_content = true;
                }
                total_messages += meta.message_count;
                if let Some(ts) = meta.last_updated_at {
                    if ts > latest_updated {
                        latest_updated = ts;
                    }
                }
            }
        }

        if !has_any_content {
            continue;
        }

        let name = Path::new(&ws.folder_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| ws.folder_path.clone());

        let last_modified = if latest_updated > 0 {
            millis_to_rfc3339(latest_updated)
        } else {
            String::new()
        };

        projects.push(ClaudeProject {
            name,
            path: format!("cursor://{}", ws.hash),
            actual_path: ws.folder_path.clone(),
            session_count: ws.composer_ids.len(),
            message_count: total_messages,
            last_modified,
            git_info: None,
            provider: Some("cursor".to_string()),
        });
    }

    projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(projects)
}

/// Load sessions (composers) for a Cursor workspace project.
pub fn load_sessions(
    project_path: &str,
    _exclude_sidechain: bool,
) -> Result<Vec<ClaudeSession>, String> {
    let base_path = get_base_path().ok_or_else(|| "Cursor not found".to_string())?;

    // Extract workspace hash from virtual path "cursor://{hash}"
    let ws_hash = project_path
        .strip_prefix("cursor://")
        .unwrap_or(project_path);

    if !is_safe_storage_id(ws_hash) {
        return Err(format!("Invalid workspace hash: {ws_hash}"));
    }

    // Read composer IDs from the workspace DB
    let ws_db_path = Path::new(&base_path)
        .join("workspaceStorage")
        .join(ws_hash)
        .join("state.vscdb");
    let composer_ids = if ws_db_path.exists() {
        read_workspace_composer_ids(&ws_db_path)?
    } else {
        return Ok(Vec::new());
    };

    // Read workspace folder for project name
    let ws_json_path = Path::new(&base_path)
        .join("workspaceStorage")
        .join(ws_hash)
        .join("workspace.json");
    let folder = read_workspace_folder(&ws_json_path).unwrap_or_default();
    let project_name = Path::new(&folder)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Load metadata for each composer from global DB
    let global_db_path = Path::new(&base_path)
        .join("globalStorage")
        .join("state.vscdb");
    let global_conn = open_db(&global_db_path)?;

    let mut sessions: Vec<ClaudeSession> = Vec::new();

    for cid in &composer_ids {
        let meta = match read_composer_meta(&global_conn, cid)? {
            Some(m) => m,
            None => continue,
        };

        if meta.message_count == 0 {
            continue;
        }

        let first_time = meta.created_at.map(millis_to_rfc3339).unwrap_or_default();
        let last_time = meta
            .last_updated_at
            .map(millis_to_rfc3339)
            .unwrap_or_default();

        let summary = meta.name.or_else(|| {
            meta.status
                .as_deref()
                .filter(|s| *s != "none")
                .map(String::from)
        });

        sessions.push(ClaudeSession {
            session_id: format!("cursor://{cid}"),
            actual_session_id: cid.clone(),
            file_path: format!("cursor://{cid}"),
            project_name: project_name.clone(),
            message_count: meta.message_count,
            first_message_time: first_time.clone(),
            last_message_time: last_time.clone(),
            last_modified: last_time,
            has_tool_use: meta.has_tool_use,
            has_errors: false,
            summary,
            provider: Some("cursor".to_string()),
        });
    }

    sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(sessions)
}

/// Load all messages from a Cursor composer conversation.
pub fn load_messages(session_path: &str) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "Cursor not found".to_string())?;

    // Extract composer ID from virtual path "cursor://{composerId}"
    let composer_id = session_path
        .strip_prefix("cursor://")
        .unwrap_or(session_path);

    if !is_valid_uuid(composer_id) {
        return Err(format!("Invalid composer ID: {composer_id}"));
    }

    let global_db_path = Path::new(&base_path)
        .join("globalStorage")
        .join("state.vscdb");
    let global_conn = open_db(&global_db_path)?;

    let key = format!("composerData:{composer_id}");
    let raw = match query_cursor_kv(&global_conn, &key)? {
        Some(v) => v,
        None => return Err(format!("Composer not found: {composer_id}")),
    };
    let val: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let schema_version = val.get("_v").and_then(Value::as_i64).unwrap_or(0);

    let messages = if schema_version >= 6 {
        load_messages_v6(&global_conn, composer_id, &val)?
    } else {
        load_messages_v1(composer_id, &val)
    };

    Ok(messages)
}

/// Load messages from schema v1-v5 (inline `conversation` array).
fn load_messages_v1(composer_id: &str, val: &Value) -> Vec<ClaudeMessage> {
    let conversation = val
        .get("conversation")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut messages = Vec::new();
    for (i, bubble) in conversation.iter().enumerate() {
        if let Some(msg) = bubble_to_message(bubble, composer_id, i as u64) {
            messages.push(msg);
        }
    }
    messages
}

/// Load messages from schema v6+ (`fullConversationHeadersOnly` + separate blobs).
fn load_messages_v6(
    conn: &Connection,
    composer_id: &str,
    val: &Value,
) -> Result<Vec<ClaudeMessage>, String> {
    let headers = val
        .get("fullConversationHeadersOnly")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut messages = Vec::new();

    for (i, header) in headers.iter().enumerate() {
        let bubble_id = match header.get("bubbleId").and_then(Value::as_str) {
            Some(id) => id,
            None => continue,
        };

        // Fetch the full bubble from cursorDiskKV
        let blob_key = format!("bubbleId:{composer_id}:{bubble_id}");
        let bubble_raw = match query_cursor_kv(conn, &blob_key)? {
            Some(v) => v,
            None => continue,
        };
        let bubble: Value = match serde_json::from_str(&bubble_raw) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if let Some(msg) = bubble_to_message(&bubble, composer_id, i as u64) {
            messages.push(msg);
        }
    }

    Ok(messages)
}

/// Search across all Cursor conversations using SQL-level filtering.
pub fn search(query: &str, limit: usize) -> Result<Vec<ClaudeMessage>, String> {
    let base_path = get_base_path().ok_or_else(|| "Cursor not found".to_string())?;
    let global_db_path = Path::new(&base_path)
        .join("globalStorage")
        .join("state.vscdb");
    let global_conn = open_db(&global_db_path)?;

    let query_lower = query.to_lowercase();
    let like_pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));

    // Pre-filter at SQL level for performance
    let mut stmt = global_conn
        .prepare(
            "SELECT CAST(value AS TEXT) FROM cursorDiskKV \
             WHERE key LIKE 'bubbleId:%' \
             AND CAST(value AS TEXT) LIKE ?1 ESCAPE '\\' \
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let sql_limit: i64 = i64::try_from(limit.saturating_mul(2)).unwrap_or(i64::MAX);
    let rows: Vec<String> = stmt
        .query_map(rusqlite::params![&like_pattern, sql_limit], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let mut results = Vec::new();

    for json_str in &rows {
        if results.len() >= limit {
            break;
        }

        let val: Value = match serde_json::from_str(json_str) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if let Some(msg) = bubble_to_message(&val, "", 0) {
            if let Some(content) = &msg.content {
                if search_json_value_case_insensitive(content, &query_lower) {
                    results.push(msg);
                }
            }
        }
    }

    Ok(results)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_valid_uuid() {
        assert!(is_valid_uuid("cffd0fb5-5188-4961-aca8-a1f4e53e6f08"));
        assert!(is_valid_uuid("00000000-0000-0000-0000-000000000000"));
        assert!(!is_valid_uuid(""));
        assert!(!is_valid_uuid("not-a-uuid"));
        assert!(!is_valid_uuid("cffd0fb5_5188_4961_aca8_a1f4e53e6f08"));
        assert!(!is_valid_uuid("cffd0fb5-5188-4961-aca8-a1f4e53e6f0")); // too short
        assert!(!is_valid_uuid("../../../etc/passwd"));
    }

    #[test]
    fn test_uri_to_path() {
        assert_eq!(
            uri_to_path("file:///Users/test/project"),
            "/Users/test/project"
        );
        assert_eq!(uri_to_path("/Users/test/project"), "/Users/test/project");
    }

    #[test]
    fn test_millis_to_rfc3339() {
        let result = millis_to_rfc3339(1_704_067_200_000);
        assert!(result.starts_with("2024-01-01T"));
    }

    #[test]
    fn test_epoch_ms_to_rfc3339() {
        let result = epoch_ms_to_rfc3339(1_736_412_642_598);
        assert!(result.is_some());
        let s = result.unwrap();
        assert!(s.starts_with("2025-01-09"));
    }

    #[test]
    fn test_normalize_cursor_tool_name() {
        assert_eq!(normalize_cursor_tool_name("read_file"), "Read");
        assert_eq!(normalize_cursor_tool_name("read_file_v2"), "Read");
        assert_eq!(normalize_cursor_tool_name("edit_file"), "Edit");
        assert_eq!(normalize_cursor_tool_name("run_terminal_cmd"), "Bash");
        assert_eq!(normalize_cursor_tool_name("grep_search"), "Grep");
        assert_eq!(normalize_cursor_tool_name("web_search"), "WebSearch");
        assert_eq!(normalize_cursor_tool_name("custom_tool"), "custom_tool");
    }

    #[test]
    fn test_bubble_to_message_user() {
        let bubble = serde_json::json!({
            "type": 1,
            "bubbleId": "test-bubble-1",
            "text": "Hello, world!",
            "createdAt": "2026-01-15T10:00:00.000Z",
        });
        let msg = bubble_to_message(&bubble, "session-1", 0).unwrap();
        assert_eq!(msg.message_type, "user");
        assert_eq!(msg.role.as_deref(), Some("user"));
        assert_eq!(msg.uuid, "test-bubble-1");
        assert_eq!(msg.provider.as_deref(), Some("cursor"));

        let content = msg.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "Hello, world!");
    }

    #[test]
    fn test_bubble_to_message_assistant_with_thinking_and_model() {
        let bubble = serde_json::json!({
            "type": 2,
            "bubbleId": "test-bubble-2",
            "text": "Here is my answer.",
            "thinking": { "text": "Let me think about this...", "signature": "" },
            "thinkingDurationMs": 500,
            "createdAt": "2026-01-15T10:00:01.000Z",
            "modelInfo": { "modelName": "claude-4.5-sonnet" },
            "tokenCount": { "inputTokens": 100, "outputTokens": 50 },
        });
        let msg = bubble_to_message(&bubble, "session-1", 1).unwrap();
        assert_eq!(msg.message_type, "assistant");
        assert_eq!(msg.duration_ms, Some(500));
        assert_eq!(msg.model.as_deref(), Some("claude-4.5-sonnet"));

        let usage = msg.usage.unwrap();
        assert_eq!(usage.input_tokens, Some(100));
        assert_eq!(usage.output_tokens, Some(50));

        let content = msg.content.unwrap();
        let arr = content.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["type"], "thinking");
        assert_eq!(arr[1]["type"], "text");
    }

    #[test]
    fn test_bubble_to_message_tool_use_with_normalization() {
        let bubble = serde_json::json!({
            "type": 2,
            "bubbleId": "test-bubble-3",
            "text": "",
            "capabilityType": 15,
            "toolFormerData": {
                "toolCallId": "call_123",
                "name": "read_file_v2",
                "rawArgs": "{\"path\":\"/tmp/test.txt\"}",
                "status": "completed",
                "params": "{\"content\": \"file data\"}",
            },
            "createdAt": "2026-01-15T10:00:02.000Z",
        });
        let msg = bubble_to_message(&bubble, "session-1", 2).unwrap();
        let content = msg.content.unwrap();
        let arr = content.as_array().unwrap();
        // tool_use + tool_result
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["type"], "tool_use");
        assert_eq!(arr[0]["name"], "Read"); // Normalized!
        assert_eq!(arr[0]["input"]["path"], "/tmp/test.txt");
        assert_eq!(arr[1]["type"], "tool_result");
        assert_eq!(arr[1]["is_error"], false);
    }

    #[test]
    fn test_bubble_to_message_skips_empty_capability() {
        let bubble = serde_json::json!({
            "type": 2,
            "bubbleId": "test-bubble-4",
            "text": "",
            "capabilityType": 30,
            "createdAt": "2026-01-15T10:00:03.000Z",
        });
        assert!(bubble_to_message(&bubble, "session-1", 3).is_none());
    }

    #[test]
    fn test_bubble_unknown_type_returns_none() {
        let bubble = serde_json::json!({
            "type": 99,
            "bubbleId": "test-bubble-5",
            "createdAt": "2026-01-15T10:00:04.000Z",
            "text": "Hello",
        });
        assert!(bubble_to_message(&bubble, "session-1", 4).is_none());
    }

    #[test]
    fn test_extract_composer_meta() {
        let val = serde_json::json!({
            "_v": 1,
            "composerId": "test-composer",
            "name": "Test Chat",
            "createdAt": 1_704_067_200_000_i64,
            "lastUpdatedAt": 1_704_070_800_000_i64,
            "conversation": [
                { "type": 1, "text": "Hello" },
                { "type": 2, "text": "Hi there", "toolFormerData": { "name": "read_file" } },
            ],
            "status": "completed",
        });

        let meta = extract_composer_meta(&val);
        assert_eq!(meta.name.as_deref(), Some("Test Chat"));
        assert_eq!(meta.created_at, Some(1_704_067_200_000));
        assert_eq!(meta.message_count, 2);
        assert!(meta.has_tool_use);
        assert_eq!(meta.status.as_deref(), Some("completed"));
    }
}
