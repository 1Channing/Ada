// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";

// package.json
var package_default = {
  name: "vite-react-typescript-starter",
  private: true,
  version: "1.2.4",
  type: "module",
  scripts: {
    dev: "vite",
    build: "vite build",
    lint: "eslint .",
    preview: "vite preview",
    typecheck: "tsc --noEmit -p tsconfig.app.json",
    "test:parity": "tsx test/parity/business-logic-parity.test.ts",
    "test:parity:parsing": "tsx test/parity/parsing-parity.test.ts",
    "test:parity:e2e": "tsx test/parity/e2e-parity.test.ts",
    "test:parity:scraping": "tsx test/parity/scraping-parity.test.ts",
    "test:parity:all": "npm run test:parity && npm run test:parity:parsing && npm run test:parity:e2e",
    "build:worker": "cd worker && npm ci && npm run build",
    "start:worker": "cd worker && npm start"
  },
  dependencies: {
    "@supabase/supabase-js": "^2.57.4",
    html2canvas: "^1.4.1",
    jspdf: "^3.0.4",
    "lucide-react": "^0.344.0",
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    zustand: "^5.0.9"
  },
  devDependencies: {
    "@eslint/js": "^9.9.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    autoprefixer: "^10.4.18",
    eslint: "^9.9.1",
    "eslint-plugin-react-hooks": "^5.1.0-rc.0",
    "eslint-plugin-react-refresh": "^0.4.11",
    globals: "^15.9.0",
    postcss: "^8.4.35",
    tailwindcss: "^3.4.1",
    tsx: "^4.7.0",
    typescript: "^5.5.3",
    "typescript-eslint": "^8.3.0",
    vite: "^5.4.2"
  }
};

// vite.config.ts
var vite_config_default = defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["lucide-react"]
  },
  define: {
    __APP_VERSION__: JSON.stringify(package_default.version)
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAicGFja2FnZS5qc29uIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvcHJvamVjdFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvcHJvamVjdC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHBrZyBmcm9tICcuL3BhY2thZ2UuanNvbic7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gIH0sXG4gIGRlZmluZToge1xuICAgIF9fQVBQX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkocGtnLnZlcnNpb24pLFxuICB9LFxufSk7XG4iLCAie1xuICBcIm5hbWVcIjogXCJ2aXRlLXJlYWN0LXR5cGVzY3JpcHQtc3RhcnRlclwiLFxuICBcInByaXZhdGVcIjogdHJ1ZSxcbiAgXCJ2ZXJzaW9uXCI6IFwiMS4yLjRcIixcbiAgXCJ0eXBlXCI6IFwibW9kdWxlXCIsXG4gIFwic2NyaXB0c1wiOiB7XG4gICAgXCJkZXZcIjogXCJ2aXRlXCIsXG4gICAgXCJidWlsZFwiOiBcInZpdGUgYnVpbGRcIixcbiAgICBcImxpbnRcIjogXCJlc2xpbnQgLlwiLFxuICAgIFwicHJldmlld1wiOiBcInZpdGUgcHJldmlld1wiLFxuICAgIFwidHlwZWNoZWNrXCI6IFwidHNjIC0tbm9FbWl0IC1wIHRzY29uZmlnLmFwcC5qc29uXCIsXG4gICAgXCJ0ZXN0OnBhcml0eVwiOiBcInRzeCB0ZXN0L3Bhcml0eS9idXNpbmVzcy1sb2dpYy1wYXJpdHkudGVzdC50c1wiLFxuICAgIFwidGVzdDpwYXJpdHk6cGFyc2luZ1wiOiBcInRzeCB0ZXN0L3Bhcml0eS9wYXJzaW5nLXBhcml0eS50ZXN0LnRzXCIsXG4gICAgXCJ0ZXN0OnBhcml0eTplMmVcIjogXCJ0c3ggdGVzdC9wYXJpdHkvZTJlLXBhcml0eS50ZXN0LnRzXCIsXG4gICAgXCJ0ZXN0OnBhcml0eTpzY3JhcGluZ1wiOiBcInRzeCB0ZXN0L3Bhcml0eS9zY3JhcGluZy1wYXJpdHkudGVzdC50c1wiLFxuICAgIFwidGVzdDpwYXJpdHk6YWxsXCI6IFwibnBtIHJ1biB0ZXN0OnBhcml0eSAmJiBucG0gcnVuIHRlc3Q6cGFyaXR5OnBhcnNpbmcgJiYgbnBtIHJ1biB0ZXN0OnBhcml0eTplMmVcIixcbiAgICBcImJ1aWxkOndvcmtlclwiOiBcImNkIHdvcmtlciAmJiBucG0gY2kgJiYgbnBtIHJ1biBidWlsZFwiLFxuICAgIFwic3RhcnQ6d29ya2VyXCI6IFwiY2Qgd29ya2VyICYmIG5wbSBzdGFydFwiXG4gIH0sXG4gIFwiZGVwZW5kZW5jaWVzXCI6IHtcbiAgICBcIkBzdXBhYmFzZS9zdXBhYmFzZS1qc1wiOiBcIl4yLjU3LjRcIixcbiAgICBcImh0bWwyY2FudmFzXCI6IFwiXjEuNC4xXCIsXG4gICAgXCJqc3BkZlwiOiBcIl4zLjAuNFwiLFxuICAgIFwibHVjaWRlLXJlYWN0XCI6IFwiXjAuMzQ0LjBcIixcbiAgICBcInJlYWN0XCI6IFwiXjE4LjMuMVwiLFxuICAgIFwicmVhY3QtZG9tXCI6IFwiXjE4LjMuMVwiLFxuICAgIFwienVzdGFuZFwiOiBcIl41LjAuOVwiXG4gIH0sXG4gIFwiZGV2RGVwZW5kZW5jaWVzXCI6IHtcbiAgICBcIkBlc2xpbnQvanNcIjogXCJeOS45LjFcIixcbiAgICBcIkB0eXBlcy9yZWFjdFwiOiBcIl4xOC4zLjVcIixcbiAgICBcIkB0eXBlcy9yZWFjdC1kb21cIjogXCJeMTguMy4wXCIsXG4gICAgXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiOiBcIl40LjMuMVwiLFxuICAgIFwiYXV0b3ByZWZpeGVyXCI6IFwiXjEwLjQuMThcIixcbiAgICBcImVzbGludFwiOiBcIl45LjkuMVwiLFxuICAgIFwiZXNsaW50LXBsdWdpbi1yZWFjdC1ob29rc1wiOiBcIl41LjEuMC1yYy4wXCIsXG4gICAgXCJlc2xpbnQtcGx1Z2luLXJlYWN0LXJlZnJlc2hcIjogXCJeMC40LjExXCIsXG4gICAgXCJnbG9iYWxzXCI6IFwiXjE1LjkuMFwiLFxuICAgIFwicG9zdGNzc1wiOiBcIl44LjQuMzVcIixcbiAgICBcInRhaWx3aW5kY3NzXCI6IFwiXjMuNC4xXCIsXG4gICAgXCJ0c3hcIjogXCJeNC43LjBcIixcbiAgICBcInR5cGVzY3JpcHRcIjogXCJeNS41LjNcIixcbiAgICBcInR5cGVzY3JpcHQtZXNsaW50XCI6IFwiXjguMy4wXCIsXG4gICAgXCJ2aXRlXCI6IFwiXjUuNC4yXCJcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7OztBQ0RsQjtBQUFBLEVBQ0UsTUFBUTtBQUFBLEVBQ1IsU0FBVztBQUFBLEVBQ1gsU0FBVztBQUFBLEVBQ1gsTUFBUTtBQUFBLEVBQ1IsU0FBVztBQUFBLElBQ1QsS0FBTztBQUFBLElBQ1AsT0FBUztBQUFBLElBQ1QsTUFBUTtBQUFBLElBQ1IsU0FBVztBQUFBLElBQ1gsV0FBYTtBQUFBLElBQ2IsZUFBZTtBQUFBLElBQ2YsdUJBQXVCO0FBQUEsSUFDdkIsbUJBQW1CO0FBQUEsSUFDbkIsd0JBQXdCO0FBQUEsSUFDeEIsbUJBQW1CO0FBQUEsSUFDbkIsZ0JBQWdCO0FBQUEsSUFDaEIsZ0JBQWdCO0FBQUEsRUFDbEI7QUFBQSxFQUNBLGNBQWdCO0FBQUEsSUFDZCx5QkFBeUI7QUFBQSxJQUN6QixhQUFlO0FBQUEsSUFDZixPQUFTO0FBQUEsSUFDVCxnQkFBZ0I7QUFBQSxJQUNoQixPQUFTO0FBQUEsSUFDVCxhQUFhO0FBQUEsSUFDYixTQUFXO0FBQUEsRUFDYjtBQUFBLEVBQ0EsaUJBQW1CO0FBQUEsSUFDakIsY0FBYztBQUFBLElBQ2QsZ0JBQWdCO0FBQUEsSUFDaEIsb0JBQW9CO0FBQUEsSUFDcEIsd0JBQXdCO0FBQUEsSUFDeEIsY0FBZ0I7QUFBQSxJQUNoQixRQUFVO0FBQUEsSUFDViw2QkFBNkI7QUFBQSxJQUM3QiwrQkFBK0I7QUFBQSxJQUMvQixTQUFXO0FBQUEsSUFDWCxTQUFXO0FBQUEsSUFDWCxhQUFlO0FBQUEsSUFDZixLQUFPO0FBQUEsSUFDUCxZQUFjO0FBQUEsSUFDZCxxQkFBcUI7QUFBQSxJQUNyQixNQUFRO0FBQUEsRUFDVjtBQUNGOzs7QUR4Q0EsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxjQUFjO0FBQUEsRUFDMUI7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLGlCQUFpQixLQUFLLFVBQVUsZ0JBQUksT0FBTztBQUFBLEVBQzdDO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
