# Migration Guide: Running the Portal on Another Computer

Because this portal is built using standard, vanilla web technologies and uses a lightweight Node.js server with **zero npm dependencies**, you can copy and run it on any computer without needing Antigravity or special developer tools.

## Prerequisites

The target computer only needs **Node.js** installed (version 12 or higher).
- You can download it from [nodejs.org](https://nodejs.org/).

---

## Step 1: Pack the Project (Source Computer)

On your current computer, compress the `gcp-tools-portal` directory into a zip archive.

### On macOS / Linux Terminal:
```bash
zip -r gcp-tools-portal.zip gcp-tools-portal
```

---

## Step 2: Transfer the Archive

Transfer the `gcp-tools-portal.zip` file to the target computer using a USB drive, local network share, email, cloud storage (Google Drive, Dropbox), or messaging app.

---

## Step 3: Run the Server (Target Computer)

1. **Unzip** the archive on the target computer.
2. Open your **Terminal** (macOS/Linux) or **Command Prompt/PowerShell** (Windows).
3. Navigate into the extracted `gcp-tools-portal` directory:
   ```bash
   cd path/to/gcp-tools-portal
   ```
4. Start the local server:
   ```bash
   node server.js
   ```

---

## Step 4: Access the Tools

Once the server is running, open any web browser (Chrome, Safari, Edge, Firefox) on the target computer and go to:

```text
http://localhost:8080
```

From there, you can open the **GCP Infrastructure Manager**, the **Sweep Scanner**, and access the visual documentation.
