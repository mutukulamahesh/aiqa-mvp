import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Runs from "./pages/Runs";
import RunDetail from "./pages/RunDetail";
import Editor from "./pages/Editor";
import Orchestrate from "./pages/Orchestrate";
import Tests from "./pages/Tests";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/"             element={<Dashboard />} />
        <Route path="/runs"         element={<Runs />} />
        <Route path="/runs/:id"     element={<RunDetail />} />
        <Route path="/editor"       element={<Editor />} />
        <Route path="/orchestrate"  element={<Orchestrate />} />
        <Route path="/tests"        element={<Tests />} />
      </Routes>
    </Layout>
  );
}
