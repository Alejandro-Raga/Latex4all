//! "Report a bug": sends the report (text, screenshots, app details) to the
//! relay that already serves shared projects, where whoever runs it can read
//! it. See apps/relay/reports.mjs.

use std::time::Duration;

use crate::collab::DEFAULT_RELAY;

/// Sends a report; the relay's id for it on success.
#[tauri::command]
pub async fn send_bug_report(report: serde_json::Value) -> Result<String, String> {
    let body = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    let response = reqwest::Client::new()
        .post(format!("{}/reports", DEFAULT_RELAY))
        .header("Content-Type", "application/json")
        .timeout(Duration::from_secs(90))
        .body(body)
        .send()
        .await
        .map_err(|_| {
            "Couldn't reach the server. Check your connection and try again.".to_string()
        })?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    match status {
        200..=299 => Ok(text.trim().to_string()),
        413 => Err("The report is too large: try fewer or smaller images.".to_string()),
        429 => Err("You've sent several reports today. Please try again tomorrow.".to_string()),
        _ => Err(format!(
            "The server couldn't take the report (error {}).",
            status
        )),
    }
}
