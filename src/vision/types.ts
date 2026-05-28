export interface BoundingBox {
  x: number;  // normalized 0–1, left edge as fraction of image width
  y: number;  // normalized 0–1, top edge as fraction of image height
  w: number;  // normalized 0–1, element width as fraction of image width
  h: number;  // normalized 0–1, element height as fraction of image height
}

export type ElementType = "button" | "input" | "link" | "text" | "image" | "checkbox" | "select" | "other";

export interface DetectedElement {
  id:          string;
  type:        ElementType;
  description: string;   // human-readable ("Login button", "Email input field")
  text:        string;   // visible text on or inside the element
  bbox:        BoundingBox;
  confidence:  number;   // 0–1
}

export interface OcrWord {
  text:       string;
  bbox:       BoundingBox;
  confidence: number;  // 0–1 (tesseract confidence / 100)
}

export interface VisionScanResult {
  elements:   DetectedElement[];
  ocrWords:   OcrWord[];
  capturedAt: string;  // ISO timestamp
}

// ObjectRepository composite identity — extensible; domHash/visualHash added in Phase 2
export interface RepoKey {
  url:   string;  // normalized
  title: string;  // page title at capture time
}

export interface RepoEntry {
  key:        RepoKey;
  elements:   DetectedElement[];
  capturedAt: string;
}
