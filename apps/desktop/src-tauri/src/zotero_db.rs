//! Reads the Zotero app's own database (zotero.sqlite), for when neither the
//! app nor zotero.org can answer. Only ever a copy is opened, read-only, so
//! Zotero's file is never touched; and only while Zotero is closed, since
//! the app keeps the database locked.
//!
//! Items come back shaped as zotero.org's API returns them (`{key, version,
//! data: {…}}`), so the rest of the app treats them alike.

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct DbCollection {
    key: String,
    name: String,
    parent: Option<String>,
    items: u32,
}

#[derive(Serialize)]
pub struct DbLibrary {
    /// The library version as of Zotero's last sync with zotero.org.
    version: i64,
    items: Vec<Value>,
    collections: Vec<DbCollection>,
}

/// Zotero's linkMode numbers, as the API names them.
fn link_mode(mode: i64) -> &'static str {
    match mode {
        0 => "imported_file",
        1 => "imported_url",
        2 => "linked_file",
        _ => "linked_url",
    }
}

/// Zotero's annotation type numbers, as the API names them.
fn annotation_type(kind: i64) -> &'static str {
    match kind {
        1 => "highlight",
        2 => "note",
        3 => "image",
        4 => "ink",
        5 => "underline",
        _ => "text",
    }
}

/// The folder holding zotero.sqlite.
fn data_dir() -> Option<PathBuf> {
    crate::zotero::zotero_data_dirs()
        .into_iter()
        .find(|dir| dir.join("zotero.sqlite").is_file())
}

/// Copies the database (and its write-ahead log, which holds the latest
/// changes) and opens the copy.
fn open_copy(dir: &Path) -> Result<(tempfile::TempDir, Connection), String> {
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    for name in ["zotero.sqlite", "zotero.sqlite-wal"] {
        let from = dir.join(name);
        if from.is_file() {
            std::fs::copy(&from, temp.path().join(name))
                .map_err(|e| format!("Couldn't read Zotero's database: {e}"))?;
        }
    }
    let conn = Connection::open_with_flags(
        temp.path().join("zotero.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Couldn't open Zotero's database: {e}"))?;
    Ok((temp, conn))
}

fn read(conn: &Connection) -> rusqlite::Result<DbLibrary> {
    let (library, version): (i64, i64) = conn.query_row(
        "SELECT libraryID, version FROM libraries WHERE type = 'user'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    // Every item, with its type; the fields of `data` are added below.
    let mut keys: HashMap<i64, String> = HashMap::new();
    let mut data: HashMap<i64, Map<String, Value>> = HashMap::new();
    let mut versions: HashMap<i64, i64> = HashMap::new();
    let mut order: Vec<i64> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT i.itemID, i.key, i.version, t.typeName, i.dateAdded, i.dateModified
             FROM items i JOIN itemTypesCombined t USING (itemTypeID)
             WHERE i.libraryID = ?1",
        )?;
        let rows = stmt.query_map([library], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        for row in rows {
            let (id, key, version, kind, added, modified) = row?;
            let mut d = Map::new();
            d.insert("key".into(), json!(key));
            d.insert("version".into(), json!(version));
            d.insert("itemType".into(), json!(kind));
            d.insert("dateAdded".into(), json!(iso(&added)));
            d.insert("dateModified".into(), json!(iso(&modified)));
            d.insert("tags".into(), json!([]));
            d.insert("collections".into(), json!([]));
            d.insert("relations".into(), json!({}));
            keys.insert(id, key);
            versions.insert(id, version);
            data.insert(id, d);
            order.push(id);
        }
    }

    // Fields: title, date, DOI and the rest.
    {
        let mut stmt = conn.prepare(
            "SELECT d.itemID, f.fieldName, v.value
             FROM itemData d JOIN fieldsCombined f USING (fieldID)
             JOIN itemDataValues v USING (valueID)",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, rusqlite::types::Value>(2)?,
            ))
        })?;
        for row in rows {
            let (id, field, value) = row?;
            if let Some(d) = data.get_mut(&id) {
                let value = match value {
                    rusqlite::types::Value::Text(s) => json!(field_value(&field, s)),
                    rusqlite::types::Value::Integer(n) => json!(n.to_string()),
                    rusqlite::types::Value::Real(n) => json!(n.to_string()),
                    _ => continue,
                };
                d.insert(field, value);
            }
        }
    }

    // Creators, in order.
    {
        let mut stmt = conn.prepare(
            "SELECT ic.itemID, t.creatorType, c.firstName, c.lastName, c.fieldMode
             FROM itemCreators ic JOIN creators c USING (creatorID)
             JOIN creatorTypes t USING (creatorTypeID)
             ORDER BY ic.itemID, ic.orderIndex",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<i64>>(4)?,
            ))
        })?;
        let mut creators: HashMap<i64, Vec<Value>> = HashMap::new();
        for row in rows {
            let (id, kind, first, last, mode) = row?;
            let creator = if mode == Some(1) {
                json!({ "creatorType": kind, "name": last.unwrap_or_default() })
            } else {
                json!({
                    "creatorType": kind,
                    "firstName": first.unwrap_or_default(),
                    "lastName": last.unwrap_or_default(),
                })
            };
            creators.entry(id).or_default().push(creator);
        }
        for (id, list) in creators {
            if let Some(d) = data.get_mut(&id) {
                d.insert("creators".into(), Value::Array(list));
            }
        }
    }

    // Tags.
    {
        let mut stmt = conn.prepare(
            "SELECT it.itemID, t.name, it.type FROM itemTags it JOIN tags t USING (tagID)",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        for row in rows {
            let (id, tag, kind) = row?;
            if let Some(Value::Array(tags)) = data.get_mut(&id).and_then(|d| d.get_mut("tags")) {
                tags.push(if kind == 0 {
                    json!({ "tag": tag })
                } else {
                    json!({ "tag": tag, "type": kind })
                });
            }
        }
    }

    // Collections, and which items are in them.
    let mut collections = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT c.collectionID, c.key, c.collectionName, p.key,
                    (SELECT COUNT(*) FROM collectionItems ci WHERE ci.collectionID = c.collectionID)
             FROM collections c LEFT JOIN collections p ON p.collectionID = c.parentCollectionID
             WHERE c.libraryID = ?1",
        )?;
        let rows = stmt.query_map([library], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, u32>(4)?,
            ))
        })?;
        let mut collection_keys: HashMap<i64, String> = HashMap::new();
        for row in rows {
            let (id, key, name, parent, items) = row?;
            collection_keys.insert(id, key.clone());
            collections.push(DbCollection {
                key,
                name,
                parent,
                items,
            });
        }
        let mut stmt = conn.prepare("SELECT collectionID, itemID FROM collectionItems")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (collection, id) = row?;
            let (Some(key), Some(d)) = (collection_keys.get(&collection), data.get_mut(&id)) else {
                continue;
            };
            if let Some(Value::Array(list)) = d.get_mut("collections") {
                list.push(json!(key));
            }
        }
    }

    // Attachments: their paper, file and kind.
    {
        let mut stmt = conn.prepare(
            "SELECT itemID, parentItemID, linkMode, contentType, path, storageHash
             FROM itemAttachments",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })?;
        for row in rows {
            let (id, parent, mode, content_type, path, md5) = row?;
            let parent = parent.and_then(|p| keys.get(&p).cloned());
            let Some(d) = data.get_mut(&id) else { continue };
            if let Some(parent) = parent {
                d.insert("parentItem".into(), json!(parent));
            }
            let mode = mode.unwrap_or(0);
            d.insert("linkMode".into(), json!(link_mode(mode)));
            d.entry("note").or_insert(json!(""));
            d.insert(
                "contentType".into(),
                json!(content_type.unwrap_or_default()),
            );
            let path = path.unwrap_or_default();
            if mode == 0 || mode == 1 {
                let name = path.strip_prefix("storage:").unwrap_or(&path);
                d.insert("filename".into(), json!(name));
                d.insert("md5".into(), json!(md5));
            } else if mode == 2 {
                let name = Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                d.insert("filename".into(), json!(name));
                d.insert("path".into(), json!(path));
            }
        }
    }

    // Notes under a paper.
    {
        let mut stmt = conn.prepare("SELECT itemID, parentItemID, note FROM itemNotes")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })?;
        for row in rows {
            let (id, parent, note) = row?;
            let parent = parent.and_then(|p| keys.get(&p).cloned());
            let Some(d) = data.get_mut(&id) else { continue };
            if let Some(parent) = parent {
                d.insert("parentItem".into(), json!(parent));
            }
            d.insert("note".into(), json!(unwrap_note(note.unwrap_or_default())));
        }
    }

    // Annotations on a PDF.
    {
        let mut stmt = conn.prepare(
            "SELECT itemID, parentItemID, type, authorName, text, comment, color,
                    pageLabel, sortIndex, position
             FROM itemAnnotations",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, String>(9)?,
            ))
        })?;
        for row in rows {
            let (id, parent, kind, author, text, comment, color, label, sort, position) = row?;
            let parent = keys.get(&parent).cloned();
            let Some(d) = data.get_mut(&id) else { continue };
            if let Some(parent) = parent {
                d.insert("parentItem".into(), json!(parent));
            }
            d.insert("annotationType".into(), json!(annotation_type(kind)));
            if let Some(author) = author {
                d.insert("annotationAuthorName".into(), json!(author));
            }
            d.insert("annotationText".into(), json!(text.unwrap_or_default()));
            d.insert(
                "annotationComment".into(),
                json!(comment.unwrap_or_default()),
            );
            d.insert("annotationColor".into(), json!(color.unwrap_or_default()));
            d.insert(
                "annotationPageLabel".into(),
                json!(label.unwrap_or_default()),
            );
            d.insert("annotationSortIndex".into(), json!(sort));
            d.insert("annotationPosition".into(), json!(position));
        }
    }

    // What's in the trash.
    {
        let mut stmt = conn.prepare("SELECT itemID FROM deletedItems")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
        for id in rows {
            if let Some(d) = data.get_mut(&id?) {
                d.insert("deleted".into(), json!(1));
            }
        }
    }

    let items = order
        .into_iter()
        .filter_map(|id| {
            let d = data.remove(&id)?;
            Some(json!({
                "key": keys.get(&id)?,
                "version": versions.get(&id).copied().unwrap_or(0),
                "library": { "type": "user" },
                "data": d,
            }))
        })
        .collect();

    Ok(DbLibrary {
        version,
        items,
        collections,
    })
}

/// A field as the API gives it. Zotero keeps a date as a sortable form and
/// the text typed ("2025-07-00 July 2025"), and the API gives just the text;
/// an access date is a timestamp, which the API writes in ISO form.
fn field_value(field: &str, value: String) -> String {
    match field {
        "date" => {
            let b = value.as_bytes();
            let sortable = b.len() > 11
                && b[4] == b'-'
                && b[7] == b'-'
                && b[10] == b' '
                && b[..10]
                    .iter()
                    .enumerate()
                    .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
            if sortable {
                value[11..].to_string()
            } else {
                value
            }
        }
        "accessDate" if value.len() == 19 && value.as_bytes()[10] == b' ' => iso(&value),
        _ => value,
    }
}

/// A note as the API gives it: without the wrapper Zotero stores it in.
fn unwrap_note(note: String) -> String {
    const OPEN: &str = "<div class=\"zotero-note znv1\">";
    match note
        .strip_prefix(OPEN)
        .and_then(|n| n.strip_suffix("</div>"))
    {
        Some(inner) => inner.to_string(),
        None => note,
    }
}

/// "2024-05-01 10:00:00" as the API writes it, "2024-05-01T10:00:00Z".
fn iso(sqlite_time: &str) -> String {
    format!("{}Z", sqlite_time.replacen(' ', "T", 1))
}

/// The whole library from Zotero's database, as of now.
#[tauri::command]
pub async fn zotero_db_read() -> Result<DbLibrary, String> {
    tokio::task::spawn_blocking(|| {
        let dir = data_dir().ok_or("Zotero's database wasn't found on this computer.")?;
        let (_temp, conn) = open_copy(&dir)?;
        read(&conn).map_err(|e| format!("Couldn't read Zotero's database: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The file a linked attachment points to, from Zotero's database.
pub fn linked_file(attachment_key: &str) -> Option<PathBuf> {
    let dir = data_dir()?;
    let (_temp, conn) = open_copy(&dir).ok()?;
    let path: String = conn
        .query_row(
            "SELECT a.path FROM itemAttachments a JOIN items i USING (itemID)
             WHERE i.key = ?1 AND a.linkMode = 2",
            [attachment_key],
            |r| r.get(0),
        )
        .ok()?;
    let path = PathBuf::from(path);
    path.is_file().then_some(path)
}
