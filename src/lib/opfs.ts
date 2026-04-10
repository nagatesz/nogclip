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

  onProgress?.("Validating download URL...");
  
  try {
    // First, do a HEAD request to check if the URL is valid and get content length
    const headRes = await fetch(url, { method: 'HEAD' });
    if (!headRes.ok) {
      throw new Error(`URL validation failed with status ${headRes.status}`);
    }
    
    const contentLength = +(headRes.headers.get('Content-Length') || 0);
    if (contentLength === 0) {
      throw new Error("Server reported 0 bytes - URL may be expired or invalid");
    }
    
    onProgress?.("Connecting to video stream...");
    
    const res = await fetch(url);
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    if (!res.body) {
      throw new Error("No response body");
    }

    const reader = res.body.getReader();
    let receivedLength = 0;
    let lastProgressUpdate = 0;
    let chunkCount = 0;

    onProgress?.("Downloading video...");

    while(true) {
      const {done, value} = await reader.read();
      if (done) break;
      
      if (!value || value.length === 0) {
        throw new Error("Received empty chunk during download");
      }
      
      receivedLength += value.length;
      chunkCount++;
      
      // Update progress every 1 second to avoid UI spam
      const now = Date.now();
      if (now - lastProgressUpdate > 1000) {
        if (contentLength > 0) {
          const percent = Math.round((receivedLength / contentLength) * 100);
          onProgress?.(`Downloading... ${percent}%`);
        } else {
          onProgress?.(`Downloading... ${(receivedLength / 1024 / 1024).toFixed(1)} MB`);
        }
        lastProgressUpdate = now;
      }
      
      await writable.write(value);
    }

    await writable.close();
    
    onProgress?.("Verifying download...");
    const file = await fileHandle.getFile();
    
    // Verify file size
    if (file.size === 0) {
      throw new Error("Downloaded file is empty - the video URL may have expired or requires special authentication");
    }
    
    // Verify we received at least some data
    if (chunkCount === 0) {
      throw new Error("No data chunks received during download");
    }
    
    onProgress?.("Download complete!");
    return file;
  } catch (error) {
    // Clean up on error
    try {
      await writable.close();
      await cacheDir.removeEntry(fileName);
    } catch (e) {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export async function clearOPFSCache() {
  const dir = await navigator.storage.getDirectory();
  try {
     await dir.removeEntry('video-cache', { recursive: true });
  } catch {}
}
