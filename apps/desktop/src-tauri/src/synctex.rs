//! Source → PDF lookups in SyncTeX data (the other direction, PDF → source,
//! is `parse_synctex_data` in latex.rs). Used to draw highlights and notes
//! over the compiled PDF.

use std::collections::HashSet;

/// Where something from a source line was typeset. PDF points, origin at the
/// top left of the page — the same space the viewer uses for clicks.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct SynctexBox {
    pub line: u32,
    /// 1-based, as SyncTeX numbers them.
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A SyncTeX `Input:` path as a path relative to the project: the build
/// directory's prefix and any leading `./` removed.
pub fn normalize_synctex_path(file: &str, work_dir: &str) -> String {
    let mut file = file.to_string();
    for separator in ["/", "\\"] {
        if let Some(rest) = file.strip_prefix(&format!("{work_dir}{separator}")) {
            file = rest.to_string();
            break;
        }
    }
    for prefix in ["./", ".\\"] {
        if let Some(rest) = file.strip_prefix(prefix) {
            file = rest.to_string();
            break;
        }
    }
    file.replace('\\', "/")
}

/// Every box and point typeset from `lines` of `file`.
///
/// Horizontal boxes (`(`) carry a width, height and depth, so they give the
/// area a line of text occupies; other records are single points and come back
/// with no size. Vertical boxes (`[`) are left out: they span whole paragraphs
/// or pages and say little about where one line went.
pub fn forward_boxes(
    data: &str,
    work_dir: &str,
    file: &str,
    lines: &HashSet<u32>,
) -> Vec<SynctexBox> {
    let wanted = normalize_synctex_path(file, work_dir);
    let mut tags: HashSet<u32> = HashSet::new();
    let mut magnification = 1000.0;
    let mut unit = 1.0;
    let mut x_offset = 0.0;
    let mut y_offset = 0.0;
    let mut in_content = false;
    let mut page = 0u32;
    let mut boxes = Vec::new();

    for raw in data.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if !in_content {
            if let Some(rest) = line.strip_prefix("Input:") {
                if let Some((tag, path)) = rest.split_once(':') {
                    if let Ok(tag) = tag.parse::<u32>() {
                        if normalize_synctex_path(path, work_dir) == wanted {
                            tags.insert(tag);
                        }
                    }
                }
            } else if let Some(rest) = line.strip_prefix("Magnification:") {
                magnification = rest.trim().parse().unwrap_or(1000.0);
            } else if let Some(rest) = line.strip_prefix("Unit:") {
                unit = rest.trim().parse().unwrap_or(1.0);
            } else if let Some(rest) = line.strip_prefix("X Offset:") {
                x_offset = rest.trim().parse().unwrap_or(0.0);
            } else if let Some(rest) = line.strip_prefix("Y Offset:") {
                y_offset = rest.trim().parse().unwrap_or(0.0);
            } else if line == "Content:" {
                in_content = true;
            }
            continue;
        }
        if line.starts_with("Postamble:") {
            break;
        }

        let kind = line.as_bytes()[0];
        match kind {
            b'{' => page = line[1..].parse().unwrap_or(0),
            b'}' => page = 0,
            b'(' | b'h' | b'v' | b'k' | b'x' | b'g' | b'$' if page > 0 => {
                // 1 TeX pt = 65536 sp; 1 in = 72.27 TeX pt = 72 PDF points.
                let factor = unit * magnification / (1000.0 * 65536.0) * 72.0 / 72.27;
                let Some(record) = parse_record(&line[1..]) else {
                    continue;
                };
                if !tags.contains(&record.tag) || !lines.contains(&record.line) {
                    continue;
                }
                let h = record.h as f64 * factor + x_offset;
                let v = record.v as f64 * factor + y_offset;
                let (x, y, width, height) = match record.size {
                    Some((w, height, depth)) if kind == b'(' => (
                        h,
                        v - height.abs() as f64 * factor,
                        w.abs() as f64 * factor,
                        (height.abs() + depth.abs()) as f64 * factor,
                    ),
                    _ => (h, v, 0.0, 0.0),
                };
                boxes.push(SynctexBox {
                    line: record.line,
                    page,
                    x,
                    y,
                    width,
                    height,
                });
            }
            _ => {}
        }
    }
    boxes
}

struct Record {
    tag: u32,
    line: u32,
    h: i64,
    v: i64,
    size: Option<(i64, i64, i64)>,
}

/// `<tag>,<line>[,<column>]:<h>,<v>[:<W>,<H>,<D>]`
fn parse_record(s: &str) -> Option<Record> {
    let mut parts = s.split(':');
    let mut ids = parts.next()?.split(',');
    let tag = ids.next()?.parse().ok()?;
    let line = ids.next()?.parse().ok()?;
    let (h, v) = parts.next()?.split_once(',')?;
    let size = parts.next().and_then(|size| {
        let mut values = size.split(',').map(|n| n.parse::<i64>().ok());
        Some((values.next()??, values.next()??, values.next()??))
    });
    Some(Record {
        tag,
        line,
        h: h.parse().ok()?,
        v: v.parse().ok()?,
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DATA: &str = "SyncTeX Version:1
Input:1:/tmp/build/main.tex
Input:2:./chapters/intro.tex
Input:3:/usr/share/texmf/article.cls
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{1
[1,1:4736286,4736286:30000000,40000000,0
(1,12:4736286,6553600:22000000,655360,196608
h1,12:4800000,6553600
(2,3:4736286,9000000:20000000,655360,0
(3,12:0,0:100,100,100
]
}1
{2
(1,13:4736286,4000000:22000000,655360,196608
(1,12:4736286,5000000:10000000,655360,196608
}2
Postamble:
";

    fn points(sp: i64) -> f64 {
        sp as f64 / 65536.0 * 72.0 / 72.27
    }

    #[test]
    fn finds_the_boxes_of_the_requested_lines() {
        let lines = HashSet::from([12]);
        let boxes = forward_boxes(DATA, "/tmp/build", "main.tex", &lines);
        // Line 12 of main.tex: a box and a point on page 1, and a box on page 2.
        // Line 12 of article.cls (a different input) is not included.
        assert_eq!(boxes.len(), 3);
        assert_eq!(boxes[0].page, 1);
        assert!((boxes[0].x - points(4736286)).abs() < 1e-6);
        assert!((boxes[0].y - (points(6553600) - points(655360))).abs() < 1e-6);
        assert!((boxes[0].width - points(22000000)).abs() < 1e-6);
        assert!((boxes[0].height - points(655360 + 196608)).abs() < 1e-6);
        assert_eq!((boxes[1].width, boxes[1].height), (0.0, 0.0));
        assert_eq!(boxes[2].page, 2);
    }

    #[test]
    fn matches_inputs_however_their_paths_are_written() {
        let lines = HashSet::from([3]);
        let boxes = forward_boxes(DATA, "/tmp/build", "chapters/intro.tex", &lines);
        assert_eq!(boxes.len(), 1);
        assert_eq!(
            normalize_synctex_path("/tmp/build/a/b.tex", "/tmp/build"),
            "a/b.tex"
        );
        assert_eq!(
            normalize_synctex_path("C:\\build\\a\\b.tex", "C:\\build"),
            "a/b.tex"
        );
        assert_eq!(normalize_synctex_path(".\\main.tex", "/x"), "main.tex");
    }

    #[test]
    fn ignores_vertical_boxes_and_other_lines() {
        let lines = HashSet::from([1, 99]);
        assert!(forward_boxes(DATA, "/tmp/build", "main.tex", &lines).is_empty());
    }
}
