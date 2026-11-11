import { Box, Typography } from "@mui/material";

export default function Unauthorized() {
  return (
    <Box p={5} textAlign="center">
      <Typography variant="h4" color="error">
        Access Denied
      </Typography>
      <Typography mt={2}>
        You do not have permission to view this page.
      </Typography>
    </Box>
  );
}
