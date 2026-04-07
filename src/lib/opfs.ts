export async function streamUrlToOPFS(
  url: string,
  fileName: string,
  onProgress?: (msg: string) => void
): Promise<File> {
  const dir = await navigator.storage.getDirectory();
  
  // Create /video-cache directory inside OPFS
  const cacheDir = await dir.getDirectoryHandle('video-cache', { create: true });
  
  const fileHandle = await cacheDir.getFileHandle(fileName, { create: true });
  
  // Warning: standard createWritable isn't perfectly supported in all mobile browsers 
  // without OPFS features, but modern Desktop Chrome/Safari supports it.
  const writable = await fileHandle.createWritable();

  onProgress?.("Fetching stream...");
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const contentLength = +(res.headers.get('Content-Length') || 0);
  let receivedLength = 0;

  while(true) {
    const {done, value} = await reader.read();
    if (done) break;
    
    receivedLength += value.length;
    if (contentLength > 0) {
        const percent = Math.round((receivedLength / contentLength) * 100);
        onProgress?.(`Downloading... ${percent}%`);
    } else {
        onProgress?.(`Downloading... ${(receivedLength / 1024 / 1024).toFixed(1)} MB`);
    }
    
    await writable.write(value);
  }

  await writable.close();
  
  onProgress?.("Download complete!");
  return fileHandle.getFile();
}

export async function clearOPFSCache() {
  const dir = await navigator.storage.getDirectory();
  try {
     await dir.removeEntry('video-cache', { recursive: true });
  } catch {}
}
