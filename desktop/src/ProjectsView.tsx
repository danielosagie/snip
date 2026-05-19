import { ConvexClient } from "convex/browser";
import { useConvexQuery } from "./useConvex";
import { Eyebrow } from "./ui";

interface Team {
  _id: string;
  name: string;
  slug: string;
  role: string;
  projects: Array<{
    _id: string;
    name: string;
    description?: string;
    videoCount: number;
  }>;
}

interface Props {
  client: ConvexClient | null;
  onOpen: (projectId: string) => void;
}

export function ProjectsView({ client, onOpen }: Props) {
  const teams = useConvexQuery<Team[]>(client, "teams:listWithProjects", {});

  if (!client) {
    return (
      <div style={{ color: "#888" }}>
        Convex client not configured. Open Settings and enter your deployment URL.
      </div>
    );
  }
  if (teams === undefined) {
    return <div style={{ color: "#888" }}>Loading projects…</div>;
  }
  if (teams.length === 0) {
    return (
      <div style={{ color: "#888" }}>
        No teams found. Sign in via the web app and create a team first.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header style={{ marginBottom: 2 }}>
        <Eyebrow>Workspace</Eyebrow>
        <h2 style={{ fontSize: 26, marginTop: 6 }}>Projects</h2>
      </header>
      {teams.map((team) => (
        <section key={team._id} style={{ border: "2px solid #1a1a1a" }}>
          <header
            style={{
              padding: "8px 12px",
              borderBottom: "2px solid #1a1a1a",
              background: "#1a1a1a",
              color: "#f0f0e8",
              fontWeight: 900,
              letterSpacing: "-0.01em",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {team.name}
            <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.6 }}>
              {team.slug} • {team.role}
            </span>
          </header>
          {team.projects.length === 0 ? (
            <div style={{ padding: 14, color: "#888", fontSize: 13 }}>
              No projects in this team yet.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {team.projects.map((project) => (
                <li
                  key={project._id}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid #ccc",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{project.name}</div>
                    {project.description ? (
                      <div style={{ fontSize: 12, color: "#888" }}>
                        {project.description}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                      {project.videoCount} videos
                    </div>
                  </div>
                  <button onClick={() => onOpen(project._id)}>Open</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
