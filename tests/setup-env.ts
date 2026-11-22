import "dotenv/config";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://coms:coms_dev@localhost:5432/coms_test";
process.env.BCRYPT_COST = "4"; // fast hashing in tests only
process.env.UPLOAD_DIR = "./storage/test-uploads";
