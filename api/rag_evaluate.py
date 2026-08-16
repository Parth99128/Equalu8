from http.server import BaseHTTPRequestHandler
import json, sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))
from rag_engine.evaluator import evaluate_answer
from rag_engine.config import assert_key
class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            assert_key()
            length = int(self.headers.get('content-length', 0))
            body = json.loads(self.rfile.read(length) or b'{}')
            question = body.get('question')
            student_answer = body.get('student_answer','')
            if not question:
                self.send_response(400)
                self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
                self.wfile.write(json.dumps({"error":"question required"}).encode()); return
            result = evaluate_answer(question, student_answer)
            self.send_response(200)
            self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except RuntimeError as e:
            self.send_response(503)
            self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type','application/json'); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()
