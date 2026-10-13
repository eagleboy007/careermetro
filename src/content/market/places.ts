import { z } from "zod";
import { marketState, type MarketState } from "@/lib/schemas";

/*
 * The tile map (handoff C6): one square per state or union territory on a 9 × 7 grid, placed roughly where it is.
 * Not drawn to scale and not a boundary map, so no boundary file is needed. Cities are the ones the search and the
 * city figures know, largest first. Real place names, not example data.
 */
const STATES: MarketState[] = [
  { code: "JK", name: "Jammu and Kashmir", col: 2, row: 0, cities: ["Srinagar", "Jammu"] },
  { code: "LA", name: "Ladakh", col: 3, row: 0, cities: ["Leh"] },
  { code: "PB", name: "Punjab", col: 0, row: 1, cities: ["Mohali", "Ludhiana"] },
  { code: "CH", name: "Chandigarh", col: 1, row: 1, cities: ["Chandigarh"] },
  { code: "HP", name: "Himachal Pradesh", col: 2, row: 1, cities: ["Shimla"] },
  { code: "UK", name: "Uttarakhand", col: 3, row: 1, cities: ["Dehradun"] },
  { code: "RJ", name: "Rajasthan", col: 0, row: 2, cities: ["Jaipur", "Udaipur"] },
  { code: "HR", name: "Haryana", col: 1, row: 2, cities: ["Gurugram", "Faridabad"] },
  { code: "DL", name: "Delhi", col: 2, row: 2, cities: ["New Delhi"] },
  { code: "UP", name: "Uttar Pradesh", col: 3, row: 2, cities: ["Noida", "Lucknow"] },
  { code: "BR", name: "Bihar", col: 4, row: 2, cities: ["Patna"] },
  { code: "SK", name: "Sikkim", col: 6, row: 2, cities: ["Gangtok"] },
  { code: "AR", name: "Arunachal Pradesh", col: 8, row: 2, cities: ["Itanagar"] },
  { code: "GJ", name: "Gujarat", col: 0, row: 3, cities: ["Ahmedabad", "Vadodara", "Gandhinagar"] },
  { code: "MP", name: "Madhya Pradesh", col: 1, row: 3, cities: ["Indore", "Bhopal"] },
  { code: "CG", name: "Chhattisgarh", col: 2, row: 3, cities: ["Raipur"] },
  { code: "JH", name: "Jharkhand", col: 3, row: 3, cities: ["Ranchi"] },
  { code: "WB", name: "West Bengal", col: 4, row: 3, cities: ["Kolkata"] },
  { code: "AS", name: "Assam", col: 6, row: 3, cities: ["Guwahati"] },
  { code: "NL", name: "Nagaland", col: 7, row: 3, cities: ["Kohima"] },
  { code: "DH", name: "Dadra and Nagar Haveli and Daman and Diu", col: 0, row: 4, cities: ["Silvassa"] },
  { code: "MH", name: "Maharashtra", col: 1, row: 4, cities: ["Pune", "Mumbai", "Nagpur"] },
  { code: "TG", name: "Telangana", col: 2, row: 4, cities: ["Hyderabad"] },
  { code: "OD", name: "Odisha", col: 3, row: 4, cities: ["Bhubaneswar"] },
  { code: "ML", name: "Meghalaya", col: 6, row: 4, cities: ["Shillong"] },
  { code: "MN", name: "Manipur", col: 7, row: 4, cities: ["Imphal"] },
  { code: "GA", name: "Goa", col: 0, row: 5, cities: ["Panaji"] },
  { code: "KA", name: "Karnataka", col: 1, row: 5, cities: ["Bengaluru", "Mysuru", "Mangaluru"] },
  { code: "AP", name: "Andhra Pradesh", col: 2, row: 5, cities: ["Visakhapatnam", "Vijayawada"] },
  { code: "TR", name: "Tripura", col: 6, row: 5, cities: ["Agartala"] },
  { code: "MZ", name: "Mizoram", col: 7, row: 5, cities: ["Aizawl"] },
  { code: "LD", name: "Lakshadweep", col: 0, row: 6, cities: ["Kavaratti"] },
  { code: "KL", name: "Kerala", col: 1, row: 6, cities: ["Kochi", "Thiruvananthapuram"] },
  { code: "TN", name: "Tamil Nadu", col: 2, row: 6, cities: ["Chennai", "Coimbatore"] },
  { code: "PY", name: "Puducherry", col: 3, row: 6, cities: ["Puducherry"] },
  { code: "AN", name: "Andaman and Nicobar Islands", col: 5, row: 6, cities: ["Port Blair"] },
];

export const marketStates: MarketState[] = z.array(marketState).parse(STATES);
