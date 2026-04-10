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

  onProgress?.("Connecting to video stream...");
  
  try {
    const res = await fetch(url, {
      // Important: don't set mode to 'cors' for YouTube direct URLs as they may not support it
      // ytdl-core returns direct URLs that should work
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    if (!res.body) {
      throw new Error("No response body");
    }

    const reader = res.body.getReader();
    const contentLength = +(res.headers.get('Content-Length') || 0);
    let receivedLength = 0;
    let lastProgressUpdate = 0;

    onProgress?.("Downloading video...");

    while(true) {
      const {done, value} = await reader.read();
      if (done) break;
      
      receivedLength += value.length;
      
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
    
    onProgress?.("Download complete!");
    const file = await fileHandle.getFile();
    
    // Verify file size
    if (file.size === 0) {
      throw new Error("Downloaded file is empty");
    }
    
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
