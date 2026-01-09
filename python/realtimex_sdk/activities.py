"""
Activities Module - Supabase CRUD operations
"""

from typing import Any, Dict, List, Optional
from supabase import create_client, Client


class ActivitiesModule:
    """CRUD operations for activities table in Supabase."""
    
    def __init__(self, supabase_url: str, supabase_key: str):
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.table_name = "activities"
    
    async def insert(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Insert a new activity."""
        response = self.supabase.table(self.table_name).insert({
            "raw_data": raw_data,
            "status": "pending"
        }).execute()
        
        if not response.data:
            raise Exception("Failed to insert activity")
        
        return response.data[0]
    
    async def update(self, id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """Update an existing activity."""
        response = self.supabase.table(self.table_name).update(
            updates
        ).eq("id", id).execute()
        
        if not response.data:
            raise Exception("Failed to update activity")
        
        return response.data[0]
    
    async def delete(self, id: str) -> None:
        """Delete an activity."""
        self.supabase.table(self.table_name).delete().eq("id", id).execute()
    
    async def get(self, id: str) -> Optional[Dict[str, Any]]:
        """Get an activity by ID."""
        response = self.supabase.table(self.table_name).select(
            "*"
        ).eq("id", id).execute()
        
        if not response.data:
            return None
        
        return response.data[0]
    
    async def list(
        self,
        status: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """List activities with optional filters."""
        query = self.supabase.table(self.table_name).select("*")
        
        if status:
            query = query.eq("status", status)
        
        response = query.order("created_at", desc=True).limit(limit).execute()
        
        return response.data or []
