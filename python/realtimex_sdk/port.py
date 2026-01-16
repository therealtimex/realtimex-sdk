"""
Port utilities for Local Apps
Helps find available ports to avoid conflicts when multiple apps run simultaneously
"""

import os
import socket
from typing import Optional


class PortModule:
    """
    Port detection and management utilities.
    
    Example:
        >>> from realtimex_sdk import RealtimeXSDK
        >>> sdk = RealtimeXSDK()
        >>> port = sdk.port.get_port()
        >>> # Use port for your server
    """
    
    def __init__(self, default_port: int = 8080):
        """
        Initialize PortModule.
        
        Args:
            default_port: Default port to use if RTX_PORT is not set (default: 8080)
        """
        self.default_port = default_port
    
    def get_suggested_port(self) -> int:
        """
        Get suggested port from environment (RTX_PORT) or default.
        
        Returns:
            Port number from RTX_PORT environment variable, or default_port
        """
        env_port = os.environ.get("RTX_PORT")
        return int(env_port) if env_port else self.default_port
    
    def is_port_available(self, port: int) -> bool:
        """
        Check if a port is available.
        
        Args:
            port: Port number to check
            
        Returns:
            True if port is available, False otherwise
        """
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return True
            except OSError:
                return False
    
    def find_available_port(
        self, 
        start_port: Optional[int] = None, 
        max_attempts: int = 100
    ) -> int:
        """
        Find an available port starting from the given port.
        
        Args:
            start_port: Starting port number (default: suggested port)
            max_attempts: Maximum number of ports to try (default: 100)
            
        Returns:
            An available port number
            
        Raises:
            RuntimeError: If no available port found in range
        """
        port = start_port if start_port is not None else self.get_suggested_port()
        
        for i in range(max_attempts):
            current_port = port + i
            if self.is_port_available(current_port):
                return current_port
        
        raise RuntimeError(f"No available port found in range {port}-{port + max_attempts - 1}")
    
    def get_port(self) -> int:
        """
        Get a ready-to-use port.
        
        Returns the suggested port if available, otherwise finds the next available port.
        This is the recommended method for most use cases.
        
        Returns:
            An available port number
            
        Example:
            >>> sdk = RealtimeXSDK()
            >>> port = sdk.port.get_port()
            >>> ui.run(port=port)  # NiceGUI
        """
        suggested = self.get_suggested_port()
        if self.is_port_available(suggested):
            return suggested
        return self.find_available_port(suggested + 1)
