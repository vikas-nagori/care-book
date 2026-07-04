-- Make phone number optional on patients table
ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;
