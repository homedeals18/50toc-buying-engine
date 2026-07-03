const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export async function getModuleHealth(modulePath: string): Promise<{ module: string; status: string }> {
  const response = await fetch(`${API_BASE_URL}/${modulePath}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed for ${modulePath}`);
  }
  return response.json();
}
