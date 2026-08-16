"""
Syllabus Analyzer - Analyzes uploaded syllabus documents to extract module structure,
key concepts, learning objectives, and suggested question distributions.
"""

import json
import re
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict

from .ai_client import AIClient


@dataclass
class Topic:
    id: str
    title: str
    description: str
    chunk_indices: List[int]
    concepts: List[str]


@dataclass
class Module:
    id: str
    title: str
    description: str
    topics: List[Topic]
    chunk_indices: List[int]
    weight: float


@dataclass
class SyllabusAnalysis:
    document_id: int
    document_title: str
    summary: str
    key_concepts: List[str]
    module_structure: List[Module]
    concept_coverage: Dict[str, float]
    suggested_distribution: Dict[str, Any]
    difficulty_distribution: Dict[str, int]
    learning_objectives: List[str]
    prerequisites: List[str]


class SyllabusAnalyzer:
    """Analyzes syllabus documents using AI to extract structured information."""
    
    def __init__(self, ai_client: Optional[AIClient] = None):
        self.ai_client = ai_client or AIClient()
    
    def analyze(self, document_id: int, document_title: str, chunks: List[Dict], content: str) -> SyllabusAnalysis:
        """
        Analyze a syllabus document and return structured analysis.
        
        Args:
            document_id: Database ID of the document
            document_title: Title of the document
            chunks: List of chunk dictionaries with text, page, tokens, etc.
            content: Full document text content
            
        Returns:
            SyllabusAnalysis object with all extracted information
        """
        # Prepare chunk text for analysis
        chunk_texts = [f"[Chunk {i+1} | p{c.get('page', 1)}]: {c.get('text', '')}" 
                       for i, c in enumerate(chunks)]
        chunks_combined = "\n\n".join(chunk_texts)
        
        # Try AI analysis first
        try:
            ai_result = self._analyze_with_ai(document_title, chunks_combined, content)
            if ai_result:
                return self._build_analysis(document_id, document_title, chunks, ai_result)
        except Exception as e:
            print(f"AI analysis failed, using fallback: {e}")
        
        # Fallback to local analysis
        return self._analyze_locally(document_id, document_title, chunks, content)
    
    def _analyze_with_ai(self, title: str, chunks_text: str, full_content: str) -> Optional[Dict]:
        """Use AI to analyze the syllabus."""
        prompt = f"""You are Gemma 4, an expert educational curriculum analyst.
Analyze this syllabus document and extract structured information.

DOCUMENT TITLE: {title}

SYLLABUS CONTENT (CHUNKS):
{chunks_text}

FULL DOCUMENT PREVIEW:
{full_content[:6000]}

Return ONLY a JSON object with this exact structure:
{{
  "summary": "2-3 sentence summary of the course/syllabus",
  "key_concepts": ["concept1", "concept2", "concept3", ...],
  "module_structure": [
    {{
      "id": "module_1",
      "title": "Module 1: Title",
      "description": "Brief description of this module",
      "topics": [
        {{
          "id": "topic_1_1",
          "title": "Topic 1.1: Title",
          "description": "Brief description",
          "chunk_indices": [0, 1],
          "concepts": ["concept_a", "concept_b"]
        }}
      ],
      "chunk_indices": [0, 1, 2],
      "weight": 1.0
    }}
  ],
  "concept_coverage": {{
    "concept_name": 85.5
  }},
  "suggested_distribution": {{
    "mcq": 4,
    "short": 3,
    "conceptual": 3,
    "total": 10,
    "rationale": "Explanation of why this distribution fits the syllabus"
  }},
  "difficulty_distribution": {{
    "easy": 3,
    "medium": 5,
    "hard": 2
  }},
  "learning_objectives": ["objective1", "objective2", ...],
  "prerequisites": ["prereq1", "prereq2", ...]
}}

Guidelines:
- Identify 5-15 key concepts from the syllabus
- Create 3-8 modules based on the document structure
- Each module should have 2-5 topics
- chunk_indices should reference the chunk numbers (0-based) that relate to each module/topic
- concept_coverage: percentage (0-100) of how well each concept is covered in the chunks
- suggested_distribution: total questions 6-20 based on content depth
- learning_objectives: 5-10 specific, measurable objectives
- prerequisites: 3-6 prerequisite topics/skills
"""
        try:
            response = self.ai_client.generate(prompt, max_tokens=4096, temperature=0.3)
            if response:
                # Extract JSON from response
                start = response.find('{')
                end = response.rfind('}')
                if start != -1 and end != -1:
                    json_str = response[start:end+1]
                    return json.loads(json_str)
        except Exception as e:
            print(f"AI analysis error: {e}")
        return None
    
    def _analyze_locally(self, document_id: int, document_title: str, chunks: List[Dict], content: str) -> SyllabusAnalysis:
        """Fallback local analysis without AI."""
        # Extract key concepts from content
        key_concepts = self._extract_key_concepts(content)
        
        # Create basic module structure from chunks
        module_structure = self._create_module_structure(chunks, key_concepts)
        
        # Calculate concept coverage
        concept_coverage = self._calculate_concept_coverage(chunks, key_concepts)
        
        # Suggest distribution based on content length
        total_chunks = len(chunks)
        total_questions = min(max(total_chunks // 2, 6), 20)
        mcq = max(1, total_questions // 3)
        short = max(1, total_questions // 3)
        conceptual = total_questions - mcq - short
        
        # Extract learning objectives
        learning_objectives = self._extract_learning_objectives(content)
        
        # Extract prerequisites
        prerequisites = self._extract_prerequisites(content)
        
        return SyllabusAnalysis(
            document_id=document_id,
            document_title=document_title,
            summary=self._generate_summary(content, key_concepts),
            key_concepts=key_concepts[:15],
            module_structure=module_structure,
            concept_coverage=concept_coverage,
            suggested_distribution={
                "mcq": mcq,
                "short": short,
                "conceptual": conceptual,
                "total": total_questions,
                "rationale": f"Based on {total_chunks} content chunks covering {len(key_concepts)} key concepts"
            },
            difficulty_distribution={
                "easy": max(1, total_questions // 4),
                "medium": max(1, total_questions // 2),
                "hard": max(1, total_questions // 4)
            },
            learning_objectives=learning_objectives[:10],
            prerequisites=prerequisites[:6]
        )
    
    def _extract_key_concepts(self, content: str) -> List[str]:
        """Extract key concepts from syllabus content."""
        # Common educational/technical concept patterns
        concept_patterns = [
            r'\b(?:Module|Unit|Chapter|Section)\s+\d+[:\-]\s*([A-Z][a-zA-Z\s]+)',
            r'\b(?:Topic|Concept|Principle|Theory|Framework|Model|Algorithm|Method|Technique|Approach|Paradigm)\b',
            r'\b(?:Learning|Assessment|Evaluation|Feedback|Pedagogy|Curriculum|Instruction|Cognition|Metacognition)\b',
            r'\b(?:Neural|Deep|Machine|Reinforcement|Supervised|Unsupervised|Transfer|Active|Continual|Federated)\s+(?:Learning|Network|Model|System)\b',
            r'\b(?:Overfitting|Generalization|Regularization|Optimization|Gradient|Backpropagation|Attention|Transformer)\b',
            r'\b(?:Bias|Variance|Fairness|Ethics|Privacy|Security|Interpretability|Explainability|Robustness)\b',
        ]
        
        concepts = set()
        for pattern in concept_patterns:
            matches = re.findall(pattern, content, re.IGNORECASE)
            for match in matches:
                if isinstance(match, tuple):
                    match = match[0] if match else ""
                clean = match.strip().rstrip(':.,;')
                if len(clean) > 3 and len(clean) < 50:
                    concepts.add(clean)
        
        # Also extract capitalized phrases that look like concepts
        capitalized = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b', content)
        for c in capitalized:
            if len(c) > 5 and len(c) < 50 and c not in concepts:
                concepts.add(c)
        
        return list(concepts)[:20]
    
    def _create_module_structure(self, chunks: List[Dict], key_concepts: List[str]) -> List[Module]:
        """Create module structure from chunks."""
        modules = []
        chunks_per_module = max(1, len(chunks) // 4)
        
        for i in range(0, len(chunks), chunks_per_module):
            module_chunks = chunks[i:i+chunks_per_module]
            module_id = f"module_{len(modules)+1}"
            
            # Create topics from chunks
            topics = []
            for j, chunk in enumerate(module_chunks):
                topic_id = f"{module_id}_topic_{j+1}"
                # Extract concepts relevant to this chunk
                chunk_text = chunk.get('text', '')
                topic_concepts = [c for c in key_concepts if c.lower() in chunk_text.lower()][:3]
                
                topics.append(Topic(
                    id=topic_id,
                    title=f"Topic {len(modules)+1}.{j+1}",
                    description=chunk_text[:150] + "..." if len(chunk_text) > 150 else chunk_text,
                    chunk_indices=[i+j],
                    concepts=topic_concepts
                ))
            
            # Collect all chunk indices for this module
            chunk_indices = list(range(i, min(i+chunks_per_module, len(chunks))))
            
            modules.append(Module(
                id=module_id,
                title=f"Module {len(modules)+1}",
                description=f"Content from chunks {chunk_indices[0]+1}-{chunk_indices[-1]+1}",
                topics=topics,
                chunk_indices=chunk_indices,
                weight=1.0
            ))
        
        return modules
    
    def _calculate_concept_coverage(self, chunks: List[Dict], key_concepts: List[str]) -> Dict[str, float]:
        """Calculate how well each concept is covered in the chunks."""
        coverage = {}
        all_text = " ".join([c.get('text', '') for c in chunks]).lower()
        
        for concept in key_concepts:
            concept_lower = concept.lower()
            # Count occurrences
            count = all_text.count(concept_lower)
            # Normalize to 0-100 scale
            coverage[concept] = min(100.0, count * 10.0 + 20.0)
        
        return coverage
    
    def _generate_summary(self, content: str, key_concepts: List[str]) -> str:
        """Generate a summary of the syllabus."""
        sentences = content.split('. ')
        first_sentences = '. '.join(sentences[:3])
        if len(first_sentences) > 300:
            first_sentences = first_sentences[:300] + "..."
        return f"{first_sentences} This syllabus covers {len(key_concepts)} key concepts including {', '.join(key_concepts[:5])}."
    
    def _extract_learning_objectives(self, content: str) -> List[str]:
        """Extract learning objectives from content."""
        objectives = []
        # Look for objective-like patterns
        patterns = [
            r'(?:learn|understand|apply|analyze|evaluate|create|design|implement|develop|master)\s+[^.]{10,100}',
            r'(?:objective|goal|aim|outcome)[:\-]\s*[^.]{10,100}',
            r'(?:student|learner|participant)\s+(?:will|should|can)\s+[^.]{10,100}',
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, content, re.IGNORECASE)
            for match in matches:
                clean = match.strip().rstrip('.')
                if len(clean) > 15:
                    objectives.append(clean.capitalize())
        
        # Default objectives if none found
        if not objectives:
            objectives = [
                "Understand fundamental concepts and principles",
                "Apply theoretical knowledge to practical problems",
                "Analyze and evaluate different approaches",
                "Design solutions using learned techniques",
                "Critically assess limitations and trade-offs"
            ]
        
        return objectives[:10]
    
    def _extract_prerequisites(self, content: str) -> List[str]:
        """Extract prerequisites from content."""
        prereqs = []
        patterns = [
            r'(?:prerequisite|require|background|prior|assume|familiar)\s+[^.]{10,80}',
            r'(?:knowledge of|experience with|understanding of)\s+[^.]{10,80}',
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, content, re.IGNORECASE)
            for match in matches:
                clean = match.strip().rstrip('.')
                if len(clean) > 10:
                    prereqs.append(clean.capitalize())
        
        # Default prerequisites
        if not prereqs:
            prereqs = [
                "Basic programming knowledge",
                "Fundamental mathematics (algebra, calculus)",
                "Understanding of core computer science concepts"
            ]
        
        return prereqs[:6]
    
    def _build_analysis(self, document_id: int, document_title: str, chunks: List[Dict], ai_result: Dict) -> SyllabusAnalysis:
        """Build SyllabusAnalysis from AI result."""
        # Convert module structure
        modules = []
        for m in ai_result.get('module_structure', []):
            topics = []
            for t in m.get('topics', []):
                topics.append(Topic(
                    id=t.get('id', ''),
                    title=t.get('title', ''),
                    description=t.get('description', ''),
                    chunk_indices=t.get('chunk_indices', []),
                    concepts=t.get('concepts', [])
                ))
            modules.append(Module(
                id=m.get('id', ''),
                title=m.get('title', ''),
                description=m.get('description', ''),
                topics=topics,
                chunk_indices=m.get('chunk_indices', []),
                weight=m.get('weight', 1.0)
            ))
        
        return SyllabusAnalysis(
            document_id=document_id,
            document_title=document_title,
            summary=ai_result.get('summary', ''),
            key_concepts=ai_result.get('key_concepts', []),
            module_structure=modules,
            concept_coverage=ai_result.get('concept_coverage', {}),
            suggested_distribution=ai_result.get('suggested_distribution', {}),
            difficulty_distribution=ai_result.get('difficulty_distribution', {}),
            learning_objectives=ai_result.get('learning_objectives', []),
            prerequisites=ai_result.get('prerequisites', [])
        )


def analyze_syllabus(document_id: int, document_title: str, chunks: List[Dict], content: str) -> Dict:
    """
    Convenience function to analyze a syllabus and return dict.
    """
    analyzer = SyllabusAnalyzer()
    analysis = analyzer.analyze(document_id, document_title, chunks, content)
    return asdict(analysis)


if __name__ == "__main__":
    # Test with sample data
    test_chunks = [
        {"text": "Module 1: Foundations of Learning — Perceptron, linear separability, gradient descent dynamics and loss landscapes.", "page": 1, "tokens": 20},
        {"text": "Module 2: Generalization & Overfitting — Training accuracy is not predictive of generalization. Bias-variance tradeoff.", "page": 1, "tokens": 22},
        {"text": "Module 3: Evaluation under Imbalance — Accuracy is misleading when classes are skewed. Use F1-Score, Precision-Recall AUC.", "page": 2, "tokens": 21},
    ]
    test_content = " ".join([c["text"] for c in test_chunks])
    
    result = analyze_syllabus(1, "Test Syllabus", test_chunks, test_content)
    print(json.dumps(result, indent=2))