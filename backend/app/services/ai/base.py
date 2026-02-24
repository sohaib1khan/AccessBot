# backend/app/services/ai/base.py
from abc import ABC, abstractmethod
from typing import List, Dict, Any

class AIProvider(ABC):
    """Abstract base class for AI providers"""
    
    @abstractmethod
    async def chat(self, messages: List[Dict[str, str]], settings: Dict[str, Any]) -> str:
        """
        Send chat request and get response
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            settings: Provider-specific settings (api_key, model, temperature, etc.)
        
        Returns:
            Response text from AI
        """
        pass
    
    @abstractmethod
    async def stream_chat(self, messages: List[Dict[str, str]], settings: Dict[str, Any]):
        """
        Stream chat response (for real-time responses)
        
        Args:
            messages: List of message dicts
            settings: Provider-specific settings
            
        Yields:
            Response chunks
        """
        pass