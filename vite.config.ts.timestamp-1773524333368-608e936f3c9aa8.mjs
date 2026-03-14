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
    "@playwright/test": "^1.58.0",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    autoprefixer: "^10.4.18",
    eslint: "^9.9.1",
    "eslint-plugin-react-hooks": "^5.1.0-rc.0",
    "eslint-plugin-react-refresh": "^0.4.11",
    globals: "^15.9.0",
    playwright: "^1.58.0",
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAicGFja2FnZS5qc29uIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvcHJvamVjdFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvcHJvamVjdC92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHBrZyBmcm9tICcuL3BhY2thZ2UuanNvbic7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gIH0sXG4gIGRlZmluZToge1xuICAgIF9fQVBQX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkocGtnLnZlcnNpb24pLFxuICB9LFxufSk7XG4iLCAie1xuICBcIm5hbWVcIjogXCJ2aXRlLXJlYWN0LXR5cGVzY3JpcHQtc3RhcnRlclwiLFxuICBcInByaXZhdGVcIjogdHJ1ZSxcbiAgXCJ2ZXJzaW9uXCI6IFwiMS4yLjRcIixcbiAgXCJ0eXBlXCI6IFwibW9kdWxlXCIsXG4gIFwic2NyaXB0c1wiOiB7XG4gICAgXCJkZXZcIjogXCJ2aXRlXCIsXG4gICAgXCJidWlsZFwiOiBcInZpdGUgYnVpbGRcIixcbiAgICBcImxpbnRcIjogXCJlc2xpbnQgLlwiLFxuICAgIFwicHJldmlld1wiOiBcInZpdGUgcHJldmlld1wiLFxuICAgIFwidHlwZWNoZWNrXCI6IFwidHNjIC0tbm9FbWl0IC1wIHRzY29uZmlnLmFwcC5qc29uXCIsXG4gICAgXCJ0ZXN0OnBhcml0eVwiOiBcInRzeCB0ZXN0L3Bhcml0eS9idXNpbmVzcy1sb2dpYy1wYXJpdHkudGVzdC50c1wiLFxuICAgIFwidGVzdDpwYXJpdHk6cGFyc2luZ1wiOiBcInRzeCB0ZXN0L3Bhcml0eS9wYXJzaW5nLXBhcml0eS50ZXN0LnRzXCIsXG4gICAgXCJ0ZXN0OnBhcml0eTplMmVcIjogXCJ0c3ggdGVzdC9wYXJpdHkvZTJlLXBhcml0eS50ZXN0LnRzXCIsXG4gICAgXCJ0ZXN0OnBhcml0eTpzY3JhcGluZ1wiOiBcInRzeCB0ZXN0L3Bhcml0eS9zY3JhcGluZy1wYXJpdHkudGVzdC50c1wiLFxuICAgIFwidGVzdDpwYXJpdHk6YWxsXCI6IFwibnBtIHJ1biB0ZXN0OnBhcml0eSAmJiBucG0gcnVuIHRlc3Q6cGFyaXR5OnBhcnNpbmcgJiYgbnBtIHJ1biB0ZXN0OnBhcml0eTplMmVcIixcbiAgICBcImJ1aWxkOndvcmtlclwiOiBcImNkIHdvcmtlciAmJiBucG0gY2kgJiYgbnBtIHJ1biBidWlsZFwiLFxuICAgIFwic3RhcnQ6d29ya2VyXCI6IFwiY2Qgd29ya2VyICYmIG5wbSBzdGFydFwiXG4gIH0sXG4gIFwiZGVwZW5kZW5jaWVzXCI6IHtcbiAgICBcIkBzdXBhYmFzZS9zdXBhYmFzZS1qc1wiOiBcIl4yLjU3LjRcIixcbiAgICBcImh0bWwyY2FudmFzXCI6IFwiXjEuNC4xXCIsXG4gICAgXCJqc3BkZlwiOiBcIl4zLjAuNFwiLFxuICAgIFwibHVjaWRlLXJlYWN0XCI6IFwiXjAuMzQ0LjBcIixcbiAgICBcInJlYWN0XCI6IFwiXjE4LjMuMVwiLFxuICAgIFwicmVhY3QtZG9tXCI6IFwiXjE4LjMuMVwiLFxuICAgIFwienVzdGFuZFwiOiBcIl41LjAuOVwiXG4gIH0sXG4gIFwiZGV2RGVwZW5kZW5jaWVzXCI6IHtcbiAgICBcIkBlc2xpbnQvanNcIjogXCJeOS45LjFcIixcbiAgICBcIkBwbGF5d3JpZ2h0L3Rlc3RcIjogXCJeMS41OC4wXCIsXG4gICAgXCJAdHlwZXMvcmVhY3RcIjogXCJeMTguMy41XCIsXG4gICAgXCJAdHlwZXMvcmVhY3QtZG9tXCI6IFwiXjE4LjMuMFwiLFxuICAgIFwiQHZpdGVqcy9wbHVnaW4tcmVhY3RcIjogXCJeNC4zLjFcIixcbiAgICBcImF1dG9wcmVmaXhlclwiOiBcIl4xMC40LjE4XCIsXG4gICAgXCJlc2xpbnRcIjogXCJeOS45LjFcIixcbiAgICBcImVzbGludC1wbHVnaW4tcmVhY3QtaG9va3NcIjogXCJeNS4xLjAtcmMuMFwiLFxuICAgIFwiZXNsaW50LXBsdWdpbi1yZWFjdC1yZWZyZXNoXCI6IFwiXjAuNC4xMVwiLFxuICAgIFwiZ2xvYmFsc1wiOiBcIl4xNS45LjBcIixcbiAgICBcInBsYXl3cmlnaHRcIjogXCJeMS41OC4wXCIsXG4gICAgXCJwb3N0Y3NzXCI6IFwiXjguNC4zNVwiLFxuICAgIFwidGFpbHdpbmRjc3NcIjogXCJeMy40LjFcIixcbiAgICBcInRzeFwiOiBcIl40LjcuMFwiLFxuICAgIFwidHlwZXNjcmlwdFwiOiBcIl41LjUuM1wiLFxuICAgIFwidHlwZXNjcmlwdC1lc2xpbnRcIjogXCJeOC4zLjBcIixcbiAgICBcInZpdGVcIjogXCJeNS40LjJcIlxuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlOLFNBQVMsb0JBQW9CO0FBQ3RQLE9BQU8sV0FBVzs7O0FDRGxCO0FBQUEsRUFDRSxNQUFRO0FBQUEsRUFDUixTQUFXO0FBQUEsRUFDWCxTQUFXO0FBQUEsRUFDWCxNQUFRO0FBQUEsRUFDUixTQUFXO0FBQUEsSUFDVCxLQUFPO0FBQUEsSUFDUCxPQUFTO0FBQUEsSUFDVCxNQUFRO0FBQUEsSUFDUixTQUFXO0FBQUEsSUFDWCxXQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsSUFDZix1QkFBdUI7QUFBQSxJQUN2QixtQkFBbUI7QUFBQSxJQUNuQix3QkFBd0I7QUFBQSxJQUN4QixtQkFBbUI7QUFBQSxJQUNuQixnQkFBZ0I7QUFBQSxJQUNoQixnQkFBZ0I7QUFBQSxFQUNsQjtBQUFBLEVBQ0EsY0FBZ0I7QUFBQSxJQUNkLHlCQUF5QjtBQUFBLElBQ3pCLGFBQWU7QUFBQSxJQUNmLE9BQVM7QUFBQSxJQUNULGdCQUFnQjtBQUFBLElBQ2hCLE9BQVM7QUFBQSxJQUNULGFBQWE7QUFBQSxJQUNiLFNBQVc7QUFBQSxFQUNiO0FBQUEsRUFDQSxpQkFBbUI7QUFBQSxJQUNqQixjQUFjO0FBQUEsSUFDZCxvQkFBb0I7QUFBQSxJQUNwQixnQkFBZ0I7QUFBQSxJQUNoQixvQkFBb0I7QUFBQSxJQUNwQix3QkFBd0I7QUFBQSxJQUN4QixjQUFnQjtBQUFBLElBQ2hCLFFBQVU7QUFBQSxJQUNWLDZCQUE2QjtBQUFBLElBQzdCLCtCQUErQjtBQUFBLElBQy9CLFNBQVc7QUFBQSxJQUNYLFlBQWM7QUFBQSxJQUNkLFNBQVc7QUFBQSxJQUNYLGFBQWU7QUFBQSxJQUNmLEtBQU87QUFBQSxJQUNQLFlBQWM7QUFBQSxJQUNkLHFCQUFxQjtBQUFBLElBQ3JCLE1BQVE7QUFBQSxFQUNWO0FBQ0Y7OztBRDFDQSxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLGNBQWM7QUFBQSxFQUMxQjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04saUJBQWlCLEtBQUssVUFBVSxnQkFBSSxPQUFPO0FBQUEsRUFDN0M7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
