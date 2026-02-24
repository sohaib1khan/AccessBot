# backend/app/services/ai/generic.py
from typing import List, Dict, Any
import httpx
from app.services.ai.base import AIProvider

# Short connect timeout (fail fast if server is unreachable),
# generous read timeout for large local models that take time to generate.
_LLM_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=5.0)

class GenericLLMProvider(AIProvider):
    """
    Generic LLM provider that can work with ANY API
    Supports OpenAI-compatible, Anthropic, and custom formats
    """
    
    async def chat(self, messages: List[Dict[str, str]], settings: Dict[str, Any]) -> str:
        """Send chat request to any LLM provider"""
        
        api_format = settings.get("api_format", "openai")
        api_endpoint = settings.get("api_endpoint")
        api_key = settings.get("api_key")
        model = settings.get("model_name") or "default"
        temperature = settings.get("temperature", 0.7)
        max_tokens = settings.get("max_tokens", 1000)
        
        if not api_endpoint:
            raise ValueError("API endpoint not configured")
        
        # Build request based on format
        if api_format == "openai":
            return await self._openai_format(
                api_endpoint, api_key, messages, model, temperature, max_tokens, settings
            )
        elif api_format == "anthropic":
            return await self._anthropic_format(
                api_endpoint, api_key, messages, model, temperature, max_tokens, settings
            )
        elif api_format == "ollama":
            return await self._ollama_format(
                api_endpoint, messages, model, temperature, max_tokens, settings
            )
        elif api_format == "custom":
            return await self._custom_format(
                api_endpoint, api_key, messages, settings
            )
        else:
            raise ValueError(f"Unsupported API format: {api_format}")
    
    async def _openai_format(
        self, endpoint: str, api_key: str, messages: List[Dict], 
        model: str, temperature: float, max_tokens: int, settings: Dict
    ) -> str:
        """OpenAI-compatible format (OpenAI, Groq, Together.ai, LocalAI, etc.)"""
        
        headers = {
            "Content-Type": "application/json",
        }
        
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        
        # Add custom headers if provided
        custom_headers = settings.get("custom_headers", {})
        headers.update(custom_headers)
        
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,  # Required for LM Studio and some local servers
        }
        
        # Add extra parameters
        extra_params = settings.get("extra_params", {})
        payload.update(extra_params)
        
        async with httpx.AsyncClient(timeout=_LLM_TIMEOUT) as client:
            try:
                response = await client.post(endpoint, json=payload, headers=headers)
            except httpx.ReadTimeout:
                raise ValueError(
                    "The LLM took too long to respond (> 5 min). "
                    "Try a smaller model or raise max_tokens."
                )
            response.raise_for_status()
            data = response.json()
            
            # Extract response (OpenAI format)
            return data["choices"][0]["message"]["content"]
    
    async def _anthropic_format(
        self, endpoint: str, api_key: str, messages: List[Dict],
        model: str, temperature: float, max_tokens: int, settings: Dict
    ) -> str:
        """Anthropic Claude format"""
        
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        
        if api_key:
            headers["x-api-key"] = api_key
        
        custom_headers = settings.get("custom_headers", {})
        headers.update(custom_headers)
        
        # Anthropic requires system messages as a separate top-level key
        system_content = None
        filtered_messages = []
        for msg in messages:
            if msg["role"] == "system":
                system_content = msg["content"]
            else:
                filtered_messages.append(msg)
        
        payload = {
            "model": model,
            "messages": filtered_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        
        if system_content:
            payload["system"] = system_content
        
        extra_params = settings.get("extra_params", {})
        payload.update(extra_params)
        
        async with httpx.AsyncClient(timeout=_LLM_TIMEOUT) as client:
            try:
                response = await client.post(endpoint, json=payload, headers=headers)
            except httpx.ReadTimeout:
                raise ValueError(
                    "The LLM took too long to respond (> 5 min). "
                    "Try a smaller model or raise max_tokens."
                )
            response.raise_for_status()
            data = response.json()
            
            # Extract response (Anthropic format)
            return data["content"][0]["text"]
    
    async def _ollama_format(
        self, endpoint: str, messages: List[Dict],
        model: str, temperature: float, max_tokens: int, settings: Dict
    ) -> str:
        """Ollama local LLM format"""
        
        headers = {"Content-Type": "application/json"}
        
        # Ollama uses different structure
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            }
        }
        
        extra_params = settings.get("extra_params", {})
        if extra_params:
            payload["options"].update(extra_params)
        
        async with httpx.AsyncClient(timeout=_LLM_TIMEOUT) as client:
            try:
                response = await client.post(endpoint, json=payload, headers=headers)
            except httpx.ReadTimeout:
                raise ValueError(
                    "The LLM took too long to respond (> 5 min). "
                    "Try a smaller model or raise max_tokens."
                )
            response.raise_for_status()
            data = response.json()
            
            # Extract response (Ollama format)
            return data["message"]["content"]
    
    async def _custom_format(
        self, endpoint: str, api_key: str, messages: List[Dict], settings: Dict
    ) -> str:
        """
        Custom format - user defines request/response structure
        This requires extra configuration in settings
        """
        
        headers = {
            "Content-Type": "application/json",
        }
        
        if api_key:
            auth_type = settings.get("auth_type", "bearer")
            if auth_type == "bearer":
                headers["Authorization"] = f"Bearer {api_key}"
            elif auth_type == "api_key":
                headers["X-API-Key"] = api_key
        
        custom_headers = settings.get("custom_headers", {})
        headers.update(custom_headers)
        
        # User must provide request template in extra_params
        request_template = settings.get("extra_params", {}).get("request_template", {})
        
        # Simple template substitution
        payload = request_template.copy()
        payload["messages"] = messages
        
        async with httpx.AsyncClient(timeout=_LLM_TIMEOUT) as client:
            try:
                response = await client.post(endpoint, json=payload, headers=headers)
            except httpx.ReadTimeout:
                raise ValueError(
                    "The LLM took too long to respond (> 5 min). "
                    "Try a smaller model or raise max_tokens."
                )
            response.raise_for_status()
            data = response.json()

            # User must provide response path in extra_params
            response_path = settings.get("extra_params", {}).get("response_path", "response")
            
            # Navigate JSON path (e.g., "data.content.text")
            result = data
            for key in response_path.split("."):
                result = result[key]
            
            return result
    
    async def stream_chat(self, messages: List[Dict[str, str]], settings: Dict[str, Any]):
        """Stream support - to be implemented later"""
        # For now, just return regular chat
        response = await self.chat(messages, settings)
        yield response