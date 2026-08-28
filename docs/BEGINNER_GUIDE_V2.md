# 📘 GCP Infrastructure Manager — Beginner-Friendly Guide (Version 2)

> **Welcome!** If you are new to Google Cloud Platform, Datastore, or BigQuery, this guide was written specifically for you.  
> No complex math, no confusing jargon — just simple, step-by-step instructions with everyday analogies.

---

## 🌟 1. What is this tool? (Explain It Like I'm 5)

Imagine you own two houses:
- **House A (Source Project)**: Contains furniture and records you already have.
- **House B (Target Project)**: Your new house where you want to move some of that furniture.

Normally, moving data between Google Cloud projects requires writing complex backend code or terminal scripts that can accidentally delete things if you make a typo.

**GCP Infrastructure Manager** is your safe moving assistant:
1. **BigQuery Schema Comparison**: Checks if the blueprints of your tables in House A match House B (100% read-only, cannot break anything).
2. **Cloud Datastore Copier**: Safely copies data (called *Entities*) from House A to House B.
3. **Scheduled Query Transfer**: Copies automatic SQL timer jobs from one project to another.

---

## 🛡️ 2. The 3 Golden Safety Rules

Before doing anything, remember these 3 safeguards built into the system:

1. 🔒 **Your Token is Kept in Memory Only**:
   When you paste your Google Cloud access token, it is held strictly in your active browser tab. It is **never saved** to any database, file, or third-party server. When you close the tab, it vanishes.
2. 🔍 **Read-Only by Default**:
   Scanning datasets, analyzing tables, and comparing schemas will **never modify or delete** any data in Google Cloud.
3. ⏪ **1-Click Undo (Revert)**:
   Every time you copy Datastore entities, the tool automatically saves a backup of what was in the target project first. If you make a mistake, you can click **"1-Click Revert"** in Audit History to undo it immediately.

---

## 🚀 3. 5-Minute "Zero-to-Hero" Quickstart

Follow these 5 simple steps to perform your first safe operation:

### Step 1: Get your Google Cloud Token (Your 1-Hour VIP Pass)
Open your terminal (or Google Cloud Shell in your browser) and type:
```bash
gcloud auth print-access-token
```
Press **Enter**. You will see a long string of letters and numbers starting with `ya29...`. Copy this text.

> **What is this?** It is a temporary digital badge that proves you have permission to access your Google Cloud projects. It automatically expires after 60 minutes for safety.

---

### Step 2: Authenticate in the Portal
1. Open the **GCP Infrastructure Manager**.
2. Paste your token into the **"Paste temporary access token here..."** box.
3. Click **"Verify Token"**.
4. You will see a green badge showing your verified email and an expiration timer.

---

### Step 3: Choose What You Want to Do

Click on one of the 3 operation cards:

#### Option A: 📊 BigQuery Schema Comparison (Read-Only)
- **Use when**: You want to see if columns in Dataset A match Dataset B.
- **How to use**:
  1. Select **Source Project** & **Dataset**.
  2. Select **Target Project** & **Dataset**.
  3. Click **"Compare Schemas"**.
  4. Green rows mean columns match; red or yellow rows show missing or different data types.

#### Option B: 📦 Cloud Datastore Entity Copier
- **Use when**: You want to copy rows (entities) of a specific Kind from one project to another.
- **How to use**:
  1. Choose **Source Project** & **Database** (`(default)`).
  2. Choose **Target Project** & **Database**.
  3. Select the **Kind** (e.g. `UserProfiles`, `StoreInventory`).
  4. *(Optional)* Add filters (e.g. `status = ACTIVE`) or use Find & Replace.
  5. Click **"Analyze & Compare Entities"**.
  6. Review the list, check the entities you want to copy, and click **"Copy Selected Entities"**.

#### Option C: ⏱️ BigQuery Scheduled Queries
- **Use when**: You have recurring SQL queries configured in Project A and need them running in Project B.
- **How to use**:
  1. Select Source Project & Region.
  2. Select Target Project & Region.
  3. Review the queries and click **"Recreate in Target"**.

---

### Step 4: Using Filters Without Writing Code

Want to copy only certain rows instead of the whole database?
1. Click **"+ Add Filter"**.
2. **Property**: Type or select the column name (e.g., `role`, `status`, `createdYear`).
3. **Operator**: Choose `EQUAL (=)`, `GREATER THAN (>)`, etc.
4. **Type**: Select `String`, `Integer`, or `Boolean`.
5. **Value**: Type your value (e.g., `ACTIVE`).
6. Notice the live **GQL Preview** below: it updates in real-time so you can see the exact query being generated!

> 💡 **Pro-Tip**: Look at **Mochi**, the floating mascot in the bottom corner. Mochi offers 1-Click Quick Filter buttons like **`[Status = ACTIVE]`** or **`[Recent 24h]`** to fill them in automatically!

---

### Step 5: How to Undo a Copy (Rollback)

If you copied data by mistake:
1. Click **"Audit History"** or open the **Superadmin Activity Logs**.
2. Find the row for your copy job.
3. Click the blue **"1-Click Revert"** button.
4. The system will restore the previous entities from the automatic backup snapshot.

---

## 🤖 4. Meet Mochi – Your Smart Companion

In the bottom-right corner of the screen, you will see **Mochi**, a cute friendly mascot orb:
- **What does Mochi do?** Mochi follows what you are clicking on and displays gentle, step-by-step suggestions so you never feel lost.
- **Mochi's Expressions**:
  - 💖 **Happy**: Single click on Mochi anytime to celebrate or hear a soft chime!
  - 💢 **Grumpy**: Double click on Mochi to see him pout.
  - 🔮 **Thinking**: Appears when scanning or loading data from Google Cloud.
  - 💥 **Secret Rage**: If you click Mochi 5 times rapidly, he swells up with funny electrical anger and triggers a secret animation!
- **Keyboard Shortcuts**:
  - Press **`?`** or **`F1`** on your keyboard anytime to turn Mochi on or off.
  - Press **`Esc`** to dismiss any open guide card.

---

## 📖 5. Plain-English Jargon Buster (Glossary)

Don't let Google Cloud vocabulary confuse you. Here is what the words actually mean:

| Term | What it means in plain English |
| :--- | :--- |
| **GCP Project** | An account or folder in Google Cloud where your data and services live. |
| **Datastore** | A fast NoSQL database made by Google for saving application data. |
| **Kind** | The name of a table or category (like `Users`, `Products`, or `Orders`). |
| **Entity** | A single item or row inside a Kind. |
| **Key / Name** | The unique ID badge for an entity (like a customer ID or order number). |
| **Property** | A column or field on an entity (like `email`, `age`, or `status`). |
| **BigQuery** | Google's giant database for analytics and running SQL queries on huge tables. |
| **Schema** | The blueprint of a table (what columns exist and whether they are text, numbers, or dates). |
| **Dry Run** | A practice run! The system tests your copy in memory without actually writing anything to Google Cloud. |
| **Scheduled Query** | An automated timer that runs a SQL query on a schedule (e.g. every night at 2:00 AM). |
| **Audit Log** | A secure digital receipt recording who performed each action. |
| **Rollback / Revert** | The magic "Undo" button that puts your data back to how it was before. |

---

## ❓ 6. Frequently Asked Questions & Troubleshooting

### Q: It says "401 Unauthorized" or "Token Expired". What happened?
**Answer**: Google Cloud access tokens expire after 60 minutes for security.  
**Fix**: Open terminal, run `gcloud auth print-access-token` again, copy the new token, and paste it into the app.

---

### Q: It says "403 Forbidden" or "Permission Denied".
**Answer**: Your Google Cloud account doesn't have permission to view or write to that project.  
**Fix**: Ask your GCP project administrator to grant your email one of these roles:
- To read from a project: `roles/datastore.viewer`
- To write/copy to a project: `roles/datastore.user`
- To compare BigQuery schemas: `roles/bigquery.metadataViewer`

---

### Q: Can this tool accidentally delete my source database?
**Answer**: **Never.** The source project is strictly read-only. The tool only reads entities and compares them; it contains no code to delete or modify the source project.

---

### Q: Is my company data sent to any third-party servers?
**Answer**: **No.** All requests are sent directly from your browser to Google Cloud APIs (`https://datastore.googleapis.com` and `https://bigquery.googleapis.com`). Tokens and data never pass through third-party servers.

---

### Q: What is the difference between Version 1 and Version 2 of these docs?
- **Version 2 (This document)**: Written for everyday operators and beginners. Focuses on *how to use the tool safely and get your job done*.
- **Version 1 (Technical Manual)**: Written for software architects and security reviewers. Contains full 3D interactive pipeline models, cryptographic specs (AES-GCM), AST parsing algorithms, and memory enclave guarantees.
