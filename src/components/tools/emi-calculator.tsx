'use client'

import { useMemo, useState } from 'react'
import { Banknote, ChevronDown, Landmark, Percent, PiggyBank } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { toBn } from '@/lib/bn'

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

const money = (x: number): string => `৳ ${Math.round(x).toLocaleString('en-IN')}`

interface YearRow {
  year: number
  principal: number
  interest: number
  balance: number
}

interface EmiResult {
  emi: number
  principal: number
  totalInterest: number
  totalPayment: number
  principalPct: number
  interestPct: number
  rows: YearRow[]
  months: number
}

const MAX_MONTHS = 1200 // sanity cap: 100 years

function computeEmi(amount: number, annualRate: number, months: number): EmiResult | null {
  if (!(amount > 0) || !(annualRate >= 0) || months < 1 || months > MAX_MONTHS) return null

  const r = annualRate / 12 / 100
  const pow = Math.pow(1 + r, months)
  const emi = r === 0 ? amount / months : (amount * r * pow) / (pow - 1)

  const rows: YearRow[] = []
  let balance = amount
  let yearPrincipal = 0
  let yearInterest = 0
  let yearNo = 1

  for (let m = 1; m <= months; m++) {
    const interest = balance * r
    let principal = emi - interest
    if (m === months || principal > balance) principal = balance // final/rounding adjustment
    balance -= principal
    yearPrincipal += principal
    yearInterest += interest
    if (m % 12 === 0 || m === months) {
      rows.push({
        year: yearNo++,
        principal: yearPrincipal,
        interest: yearInterest,
        balance: Math.max(0, balance),
      })
      yearPrincipal = 0
      yearInterest = 0
    }
  }

  const totalPayment = emi * months
  return {
    emi,
    principal: amount,
    totalInterest: totalPayment - amount,
    totalPayment,
    principalPct: (amount / totalPayment) * 100,
    interestPct: ((totalPayment - amount) / totalPayment) * 100,
    rows,
    months,
  }
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

export default function EmiCalculatorTool() {
  const [amount, setAmount] = useState('500000')
  const [rate, setRate] = useState('9')
  const [tenure, setTenure] = useState('5')
  const [unit, setUnit] = useState<'years' | 'months'>('years')
  const [openTable, setOpenTable] = useState(false)

  const amountNum = parseFloat(amount)
  const rateNum = parseFloat(rate)
  const tenureNum = parseFloat(tenure)
  const months = useMemo(() => {
    if (!isFinite(tenureNum)) return 0
    return unit === 'years' ? Math.round(tenureNum * 12) : Math.round(tenureNum)
  }, [tenureNum, unit])

  const amountError = !(isFinite(amountNum) && amountNum > 0)
  const rateError = !(isFinite(rateNum) && rateNum >= 0 && rateNum <= 100)
  const tenureError = months < 1 || months > MAX_MONTHS

  const result = useMemo(
    () => (amountError || rateError || tenureError ? null : computeEmi(amountNum, rateNum, months)),
    [amountNum, rateNum, months, amountError, rateError, tenureError]
  )

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardHeader className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-primary" aria-hidden="true" />
            ঋণের তথ্য দিন
          </CardTitle>
          <CardDescription className="text-xs">
            মাসিক কিস্তি (EMI), মোট সুদ ও পরিশোধ সারণি সাথে সাথে হিসাব হবে
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="space-y-2">
            <Label htmlFor="emi-amount" className="text-sm font-medium">
              ঋণের পরিমাণ (৳)
            </Label>
            <Input
              id="emi-amount"
              type="number"
              inputMode="decimal"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="যেমন: 500000"
              aria-label="ঋণের পরিমাণ টাকায়"
              aria-invalid={amountError}
              className="h-11 text-base"
            />
            {amountError && (
              <p className="text-xs text-destructive">সঠিক ঋণের পরিমাণ লিখুন (০-এর বেশি)</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="emi-rate" className="text-sm font-medium">
              বার্ষিক সুদের হার (%)
            </Label>
            <Input
              id="emi-rate"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="যেমন: 9"
              aria-label="বার্ষিক সুদের হার শতাংশে"
              aria-invalid={rateError}
              className="h-11 text-base"
            />
            {rateError && (
              <p className="text-xs text-destructive">সুদের হার ০ থেকে ১০০-এর মধ্যে দিন</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="emi-tenure" className="text-sm font-medium">
              সময়কাল
            </Label>
            <div className="flex gap-2">
              <Input
                id="emi-tenure"
                type="number"
                inputMode="decimal"
                min={1}
                value={tenure}
                onChange={(e) => setTenure(e.target.value)}
                placeholder="যেমন: 5"
                aria-label={`সময়কাল (${unit === 'years' ? 'বছর' : 'মাস'})`}
                aria-invalid={tenureError}
                className="h-11 flex-1 text-base"
              />
              <Select value={unit} onValueChange={(v) => setUnit(v === 'months' ? 'months' : 'years')}>
                <SelectTrigger
                  className="h-11 w-[110px] shrink-0"
                  aria-label="সময়ের একক নির্বাচন করুন"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="years">বছর</SelectItem>
                  <SelectItem value="months">মাস</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tenureError && (
              <p className="text-xs text-destructive">
                সময়কাল ১ থেকে {toBn(MAX_MONTHS)} মাসের মধ্যে দিন
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {result ? (
        <>
          {/* Result cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-primary p-4 text-primary-foreground shadow-md sm:row-span-1">
              <div className="flex items-center gap-1.5 text-primary-foreground/80">
                <Banknote className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs font-medium">মাসিক কিস্তি</span>
              </div>
              <p
                className="mt-1.5 text-2xl font-bold tracking-tight"
                aria-live="polite"
                aria-label={`মাসিক কিস্তি ${money(result.emi)}`}
              >
                {money(result.emi)}
              </p>
              <p className="mt-1 text-[11px] text-primary-foreground/70">
                মোট {toBn(result.months)} মাস
              </p>
            </div>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Percent className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-xs font-medium">মোট সুদ</span>
                </div>
                <p className="mt-1.5 text-lg font-bold tracking-tight sm:text-xl">
                  {money(result.totalInterest)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <PiggyBank className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-xs font-medium">মোট পরিশোধ</span>
                </div>
                <p className="mt-1.5 text-lg font-bold tracking-tight sm:text-xl">
                  {money(result.totalPayment)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown bar */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <p className="text-sm font-medium">আসল বনাম সুদ</p>
              <div
                className="mt-3 flex h-3.5 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`আসল ${result.principalPct.toFixed(1)} শতাংশ, সুদ ${result.interestPct.toFixed(1)} শতাংশ`}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${result.principalPct}%` }}
                />
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${result.interestPct}%` }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                  আসল {money(result.principal)} ({toBn(result.principalPct.toFixed(1))}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
                  সুদ {money(result.totalInterest)} ({toBn(result.interestPct.toFixed(1))}%)
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Amortization table */}
          <Collapsible open={openTable} onOpenChange={setOpenTable}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="h-11 w-full justify-between px-4"
                aria-expanded={openTable}
              >
                বিস্তারিত পরিশোধ তালিকা দেখুন
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', openTable && 'rotate-180')}
                  aria-hidden="true"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card className="mt-3">
                <CardContent className="p-3 sm:p-4">
                  <div className="max-h-72 overflow-y-auto rounded-lg border">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background/95 backdrop-blur">
                        <TableRow>
                          <TableHead className="text-xs">বছর</TableHead>
                          <TableHead className="text-right text-xs">আসল পরিশোধ</TableHead>
                          <TableHead className="text-right text-xs">সুদ</TableHead>
                          <TableHead className="text-right text-xs">বাকি ঋণ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.rows.map((row) => (
                          <TableRow key={row.year}>
                            <TableCell className="font-medium">
                              বছর {toBn(row.year)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs sm:text-sm">
                              {money(row.principal)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-amber-600 dark:text-amber-400 sm:text-sm">
                              {money(row.interest)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs sm:text-sm">
                              {money(row.balance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    সব হিসাব আনুমানিক — ব্যাংকের প্রকৃত হিসাব ভিন্ন হতে পারে (প্রসেসিং ফি, ভাটা পরিবর্তন ইত্যাদি)।
                  </p>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Banknote className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-medium">সঠিক মান লিখুন</p>
            <p className="text-xs text-muted-foreground">
              ঋণের পরিমাণ, সুদের হার ও সময়কাল ঠিক করলেই কিস্তির হিসাব দেখা যাবে
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
