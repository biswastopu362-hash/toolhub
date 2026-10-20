'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function ToolSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-2/3 mx-auto rounded-xl" />
      <Card>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
        </CardContent>
      </Card>
    </div>
  )
}
