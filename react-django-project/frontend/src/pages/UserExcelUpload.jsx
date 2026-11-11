import { useState } from "react";
import { api } from "../services/api";
import {
  CloudArrowUpIcon as CloudUploadIcon,
  ArrowDownTrayIcon as DownloadIcon,
  CheckCircleIcon,
  ExclamationCircleIcon as AlertCircleIcon,
  DocumentArrowUpIcon as FileSpreadsheetIcon,
  TableCellsIcon as TableIcon
} from "@heroicons/react/24/outline";

export default function UserExcelUpload() {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [rows, setRows] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setRows([]);

    if (!file) {
      setError("Please select an Excel file to upload.");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.post("/api/upload-users/", formData);
      const data = res.data;

      setSuccess(`${data.inserted} users inserted successfully, ${data.skipped} skipped.`);
      setRows(data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "An error occurred during upload. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const styles = {
    container: {
      minHeight: "100vh",
      backgroundColor: "#f8fafc",
      padding: "3rem 1rem"
    },
    card: {
      backgroundColor: "#ffffff",
      borderRadius: "1.25rem",
      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
      border: "1px solid #f1f5f9",
      marginBottom: "2rem",
      overflow: "hidden"
    },
    uploadArea: {
      backgroundColor: "#f8fafc",
      borderRadius: "0.75rem",
      padding: "2rem",
      border: "2px dashed #e2e8f0",
      textAlign: "center"
    },
    uploadLabel: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      cursor: "pointer",
      padding: "1.5rem",
      transition: "all 0.3s ease"
    },
    btnPrimary: {
      backgroundColor: "#2563eb",
      color: "#ffffff",
      padding: "0.75rem 1.5rem",
      borderRadius: "0.5rem",
      fontWeight: "600",
      border: "none",
      transition: "all 0.3s ease",
      width: "100%"
    },
    btnDisabled: {
      backgroundColor: "#94a3b8",
      cursor: "not-allowed"
    },
    table: {
      width: "100%",
      borderCollapse: "collapse"
    },
    th: {
      backgroundColor: "#f8fafc",
      color: "#64748b",
      fontWeight: "700",
      fontSize: "0.75rem",
      textTransform: "uppercase",
      padding: "1rem 1.5rem",
      borderBottom: "1px solid #f1f5f9"
    },
    td: {
      padding: "1rem 1.5rem",
      fontSize: "0.875rem",
      borderBottom: "1px solid #f8fafc"
    }
  };

  return (
    <div style={styles.container}>
      <div className="container" style={{ maxWidth: "900px" }}>
        {/* Header */}
        <div className="text-center mb-5">
          <h1 className="display-6 fw-bold text-dark mb-3">User Details Upload</h1>
          <p className="lead text-secondary fs-6">
            Easily manage your team by uploading user details in bulk using an Excel file.
          </p>
        </div>

        {/* Upload Card */}
        <div style={styles.card}>
          <div className="card-body p-4 p-md-5">
            <div className="row g-4 align-items-center">
              {/* Instructions */}
              <div className="col-md-6">
                <h3 className="h5 fw-bold mb-4 d-flex align-items-center">
                  <FileSpreadsheetIcon style={{ width: "24px", marginRight: "10px", color: "#2563eb" }} />
                  Instructions
                </h3>
                <ol className="list-unstyled mb-4">
                  <li className="mb-3 d-flex align-items-start">
                    <span className="badge rounded-pill bg-primary me-2 mt-1">1</span>
                    Download the sample Excel template below.
                  </li>
                  <li className="mb-3 d-flex align-items-start">
                    <span className="badge rounded-pill bg-primary me-2 mt-1">2</span>
                    Fill in the user details following the format.
                  </li>
                  <li className="d-flex align-items-start">
                    <span className="badge rounded-pill bg-primary me-2 mt-1">3</span>
                    Upload the completed file to process data.
                  </li>
                </ol>
                <a
                  href="/user_sample.xlsx"
                  download
                  className="btn btn-outline-primary d-inline-flex align-items-center"
                >
                  <DownloadIcon style={{ width: "18px", marginRight: "8px" }} />
                  Download Sample Template
                </a>
              </div>

              {/* Upload Form */}
              <div className="col-md-6">
                <div style={styles.uploadArea}>
                  <form onSubmit={handleSubmit}>
                    <label style={styles.uploadLabel}>
                      <CloudUploadIcon style={{ width: "48px", marginBottom: "1rem", opacity: 0.6, color: "#2563eb" }} />
                      <span className="fw-semibold text-primary">
                        {file ? file.name : "Select Excel File"}
                      </span>
                      <input
                        type="file"
                        accept=".xlsx"
                        className="d-none"
                        onChange={(e) => setFile(e.target.files[0])}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={isUploading || !file}
                      style={{
                        ...styles.btnPrimary,
                        ...(isUploading || !file ? styles.btnDisabled : {})
                      }}
                      className="mt-3"
                    >
                      {isUploading ? "Processing..." : "Upload & Process"}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>

          {/* Feedback */}
          {(error || success) && (
            <div className={`p-4 border-top d-flex align-items-center gap-3 ${error ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success'}`}>
              {error ? <AlertCircleIcon style={{ width: "20px" }} /> : <CheckCircleIcon style={{ width: "20px" }} />}
              <span className="fw-bold">{error || success}</span>
            </div>
          )}
        </div>

        {/* Results Preview */}
        {rows.length > 0 && (
          <div style={styles.card}>
            <div className="card-header bg-light py-3 px-4 d-flex justify-content-between align-items-center">
              <h5 className="mb-0 fw-bold d-flex align-items-center gap-2">
                <TableIcon style={{ width: "20px", color: "#2563eb" }} />
                Uploaded Data Preview
              </h5>
              <span className="badge bg-primary rounded-pill">
                {rows.length} Records
              </span>
            </div>
            <div className="table-responsive">
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>User Emp ID</th>
                    <th style={styles.th}>Username</th>
                    <th style={styles.th}>Mail ID</th>
                    <th style={styles.th}>Profile</th>
                    <th style={styles.th}>TL Emp ID</th>
                    <th style={styles.th}>TL Name</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td style={styles.td} className="fw-bold text-dark">{r.user_employee_id}</td>
                      <td style={styles.td}>{r.username}</td>
                      <td style={styles.td}>{r.user_mail_id}</td>
                      <td style={styles.td} className="fst-italic">{r.user_profile}</td>
                      <td style={styles.td}>{r.tl_employee_id}</td>
                      <td style={styles.td} className="fw-medium">{r.tl_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
