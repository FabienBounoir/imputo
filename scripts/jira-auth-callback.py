import http.server, urllib.parse, json, sys

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(q.query)
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        if 'code' in params:
            self.wfile.write("<h1>OK — tu peux fermer cet onglet et revenir au terminal.</h1>".encode())
            with open(sys.argv[1], 'w') as f:
                json.dump({'code': params['code'][0]}, f)
            raise KeyboardInterrupt
        else:
            self.wfile.write(f"<h1>Erreur</h1><pre>{json.dumps(params, indent=2)}</pre>".encode())
            with open(sys.argv[1], 'w') as f:
                json.dump({'error': params}, f)
            raise KeyboardInterrupt
    def log_message(self, *a):
        pass

try:
    http.server.HTTPServer(('127.0.0.1', 8765), H).serve_forever()
except KeyboardInterrupt:
    print("callback captured")
