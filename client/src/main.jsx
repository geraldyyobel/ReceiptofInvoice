import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, setTimeZone } from "./api";
import { PublicApp } from "./public";
import { AdminApp } from "./admin";
import "./style.css";
function App() {
  const [config, setConfig] = useState({
    nama_aplikasi: "Receipt of Invoice · BCU",
    nama_perusahaan: "PT. Bumi Cahaya Unggul",
    tema_internal: "#2365ad",
    tema_eksternal: "#18784f",
  });
  const update = (d) => {
    setTimeZone(d.zona_waktu);
    document.title = d.nama_aplikasi;
    setConfig(d);
  };
  useEffect(() => {
    api("/public/config").then(update).catch(console.error);
  }, []);
  return location.pathname.startsWith("/admin") ? (
    <AdminApp
      config={config}
      refreshConfig={() => api("/public/config").then(update)}
    />
  ) : (
    <PublicApp config={config} />
  );
}
createRoot(document.getElementById("root")).render(<App />);
