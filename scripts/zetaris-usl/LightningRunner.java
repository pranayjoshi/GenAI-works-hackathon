// Runs SQL statements against Zetaris Lightning over JDBC (the bundle's port 10000) and prints one JSON line
// per statement: {id, sql, ok, ms, columns, rows, row_count, error}. Unlike the REST API, JDBC accepts DDL,
// so this is how the USL (COMPILE USL / ACTIVATE USL) and data-quality (REGISTER DQ / RUN DQ) statements run.
// Usage: java -cp <ndp-jdbc-driver.jar> LightningRunner.java <file.sql>
//   statements are separated by a line holding only "-- @id <name>"; credentials come from ZE / ZP env vars.
import java.nio.file.*;
import java.sql.*;
import java.util.*;

public class LightningRunner {
  static String q(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default: if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
      }
    }
    return b.append('"').toString();
  }

  public static void main(String[] a) throws Exception {
    String url = System.getenv().getOrDefault("ZURL", "jdbc:zetaris:lightning@localhost:10000");
    int maxRows = Integer.parseInt(System.getenv().getOrDefault("ZMAXROWS", "50"));
    Class.forName("com.zetaris.lightning.jdbc.LightningDriver");
    // other "-- " lines inside a statement are its question/note and are not sent
    List<String[]> stmts = new ArrayList<>();
    String id = null; StringBuilder cur = new StringBuilder(); StringBuilder note = new StringBuilder();
    for (String line : Files.readAllLines(Path.of(a[0]))) {
      if (line.startsWith("-- @id ")) {
        if (id != null) stmts.add(new String[]{id, cur.toString().trim(), note.toString().trim()});
        id = line.substring(7).trim(); cur.setLength(0); note.setLength(0);
      } else if (line.startsWith("-- ##")) { /* section header */ }
      else if (id != null && line.startsWith("--")) note.append(line.replaceFirst("^--\\s?", "")).append(' ');
      else if (id != null) cur.append(line).append('\n');
    }
    if (id != null) stmts.add(new String[]{id, cur.toString().trim(), note.toString().trim()});
    try (Connection c = DriverManager.getConnection(url, System.getenv("ZE"), System.getenv("ZP"))) {
      for (String[] st : stmts) {
        String sql = st[1].replaceAll(";\\s*$", "");
        long t0 = System.nanoTime();
        StringBuilder out = new StringBuilder("{\"id\":" + q(st[0]) + ",\"question\":" + q(st[2]) + ",\"sql\":" + q(sql));
        try (Statement s = c.createStatement()) {
          boolean rs = s.execute(sql);
          List<String> cols = new ArrayList<>(); List<String> rows = new ArrayList<>(); int n = 0;
          if (rs) try (ResultSet r = s.getResultSet()) {
            ResultSetMetaData m = r.getMetaData();
            for (int i = 1; i <= m.getColumnCount(); i++) cols.add(q(m.getColumnLabel(i)));
            while (r.next()) {
              n++;
              if (rows.size() < maxRows) {
                List<String> v = new ArrayList<>();
                for (int i = 1; i <= m.getColumnCount(); i++) { Object o = r.getObject(i); v.add(o == null ? "null" : q(String.valueOf(o))); }
                rows.add("[" + String.join(",", v) + "]");
              }
            }
          }
          long ms = (System.nanoTime() - t0) / 1_000_000;
          out.append(",\"ok\":true,\"ms\":" + ms + ",\"columns\":[" + String.join(",", cols) + "],\"row_count\":" + n + ",\"rows\":[" + String.join(",", rows) + "]}");
        } catch (Exception e) {
          long ms = (System.nanoTime() - t0) / 1_000_000;
          String msg = String.valueOf(e.getMessage()); int cut = msg.indexOf("\n\tat "); if (cut > 0) msg = msg.substring(0, cut);
          if (msg.length() > 1500) msg = msg.substring(0, 1500) + "...";
          out.append(",\"ok\":false,\"ms\":" + ms + ",\"error\":" + q(e.getClass().getSimpleName() + ": " + msg) + "}");
        }
        System.out.println(out);
        System.out.flush();
      }
    }
  }
}
