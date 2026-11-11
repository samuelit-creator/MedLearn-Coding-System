import {
  Dialog, DialogTitle, DialogContent,
  DialogActions, Button, Select,
  MenuItem, TextField
} from "@mui/material";
import { useState } from "react";
import { api } from "../services/api";

export default function QualityActionDialog({ row, onClose, onSaved, apiUrl = "/api/quality/action/" }) {
  const [action, setAction] = useState("");
  const [comment, setComment] = useState("");

  const submit = async () => {
    if (!action) return alert("Select action");

    const isCommentRequired = action === "disagree" || (action === "agree" && row.level === "audit_tl");
    if (isCommentRequired && !comment.trim())
      return alert(action === "disagree" ? "Command required" : "Comment required");

    await api.post(apiUrl, {
      id: row.id,
      action,
      comment,
      source: row.source || "audit",
      level: row.level || "coder"
    });

    onSaved();
  };

  const showComment = action === "disagree" || (action === "agree" && row.level === "audit_tl");

  return (
    <Dialog open onClose={onClose} fullWidth>
      <DialogTitle>Quality Action</DialogTitle>

      <DialogContent>
        <Select
          fullWidth
          value={action}
          onChange={e => setAction(e.target.value)}
        >
          <MenuItem value="">Select</MenuItem>
          <MenuItem value="agree">Agree</MenuItem>
          <MenuItem value="disagree">Disagree</MenuItem>
        </Select>

        {showComment && (
          <TextField
            fullWidth
            label={action === "agree" ? "Comment" : "Command"}
            multiline
            rows={3}
            margin="normal"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
