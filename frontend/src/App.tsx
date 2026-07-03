const modules = [
  "Authentication",
  "Stores",
  "Products",
  "UPC Mapping",
  "Amazon Products",
  "Rule Engine",
  "Buying Plans",
  "Purchase History",
];

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Production foundation</p>
        <h1>50TOC Buying Engine</h1>
        <p>Modular buying operations platform for stores, product mapping, rules, plans, and purchase history.</p>
      </section>
      <section className="module-grid" aria-label="Application modules">
        {modules.map((module) => (
          <article className="module-card" key={module}>
            <h2>{module}</h2>
            <p>Ready for API, service, schema, and UI expansion.</p>
          </article>
        ))}
      </section>
    </main>
  );
}
