//! Phrase-level grammar checking via a self-hosted LanguageTool server
//! (https://languagetool.org — run locally, e.g. `languagetool-server.jar`,
//! default port 8081). The app never talks to LanguageTool's cloud service;
//! this only ever calls `server_url`, which the user points at their own
//! local instance.

use serde::{Deserialize, Serialize};

const DEFAULT_TIMEOUT_SECS: u64 = 15;
const PROBE_TIMEOUT_SECS: u64 = 2;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarIssue {
    from: usize,
    to: usize,
    message: String,
    short_message: String,
    replacements: Vec<String>,
    category: String,
    /// Spelling/typo-flavored issues (LanguageTool's own typo detector, as
    /// opposed to genuine grammar/style) are surfaced with the same red
    /// styling as the system spellchecker instead of the blue grammar color.
    is_spelling: bool,
}

#[derive(Deserialize)]
struct LtResponse {
    #[serde(default)]
    matches: Vec<LtMatch>,
}

#[derive(Deserialize)]
struct LtMatch {
    message: String,
    #[serde(rename = "shortMessage", default)]
    short_message: String,
    offset: usize,
    length: usize,
    #[serde(default)]
    replacements: Vec<LtReplacement>,
    rule: LtRule,
}

#[derive(Deserialize)]
struct LtReplacement {
    value: String,
}

#[derive(Deserialize)]
struct LtRule {
    #[serde(default)]
    category: LtCategory,
    #[serde(rename = "issueType", default)]
    issue_type: String,
}

/// LanguageTool's `issueType` taxonomy that reads as "spelling/typo" to a
/// user, as opposed to genuine phrase-level grammar or style feedback.
fn is_spelling_issue_type(issue_type: &str) -> bool {
    matches!(
        issue_type,
        "misspelling" | "typographical" | "whitespace" | "duplication"
    )
}

#[derive(Deserialize, Default)]
struct LtCategory {
    #[serde(default)]
    name: String,
}

fn normalize_url(server_url: &str) -> String {
    server_url.trim_end_matches('/').to_string()
}

/// Check `text` against a self-hosted LanguageTool server, returning any
/// grammar/style issues found. `from`/`to` are UTF-16 code-unit offsets
/// (LanguageTool is Java-based; this matches JS string indexing used by the
/// editor directly, no remapping needed) into the exact text that was sent.
#[tauri::command]
pub async fn check_grammar(
    text: String,
    server_url: String,
    language: String,
) -> Result<Vec<GrammarIssue>, String> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let base = normalize_url(&server_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{base}/v2/check"))
        .form(&[
            ("text", text.as_str()),
            ("language", language.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to reach LanguageTool server at {base}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "LanguageTool server at {base} returned HTTP {}",
            resp.status()
        ));
    }

    let response_text = resp.text().await.map_err(|e| e.to_string())?;
    let parsed: LtResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse LanguageTool response: {e}"))?;

    Ok(parsed
        .matches
        .into_iter()
        .map(|m| GrammarIssue {
            from: m.offset,
            to: m.offset + m.length,
            message: m.message,
            short_message: m.short_message,
            replacements: m
                .replacements
                .into_iter()
                .map(|r| r.value)
                .take(5)
                .collect(),
            is_spelling: is_spelling_issue_type(&m.rule.issue_type),
            category: m.rule.category.name,
        })
        .collect())
}

/// Quick reachability probe so the frontend can show "server not running"
/// instead of erroring on every keystroke.
#[tauri::command]
pub async fn check_grammar_server_available(server_url: String) -> bool {
    let base = normalize_url(&server_url);
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
    else {
        return false;
    };

    client
        .get(format!("{base}/v2/languages"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}
