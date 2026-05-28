// CJS shim for pixelmatch (v7 is pure ESM; Jest runs in CJS mode)
function pixelmatch(img1, img2, output, width, height, options) {
  const threshold = (options && options.threshold != null) ? options.threshold : 0.1;
  let diffCount = 0;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const dr = Math.abs(img1[p]   - img2[p]);
    const dg = Math.abs(img1[p+1] - img2[p+1]);
    const db = Math.abs(img1[p+2] - img2[p+2]);
    if (Math.max(dr, dg, db) / 255 > threshold) {
      diffCount++;
      if (output) { output[p] = 255; output[p+1] = 0; output[p+2] = 0; output[p+3] = 255; }
    } else {
      if (output) {
        output[p]   = img1[p];   output[p+1] = img1[p+1];
        output[p+2] = img1[p+2]; output[p+3] = img1[p+3];
      }
    }
  }
  return diffCount;
}

module.exports = pixelmatch;
module.exports.default = pixelmatch;
