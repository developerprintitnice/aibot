const axios = require("axios");

axios.get("https://api.fish.audio/model").then(res => {
  const models = res.data.items;
  const females = models.filter(i => {
    if (!i.tags) return false;
    const tags = i.tags.map(t => t.toLowerCase());
    return tags.includes("female") && (tags.includes("en") || tags.includes("english"));
  });
  
  if (females.length > 0) {
    console.log("Found English Female Voices:");
    females.slice(0, 3).forEach(f => {
      console.log(`- ID: ${f._id} | Title: ${f.title}`);
    });
  } else {
    // Just find any female voice
    const anyFemale = models.find(i => {
      if (!i.tags) return false;
      const tags = i.tags.map(t => t.toLowerCase());
      return tags.includes("female");
    });
    console.log("No explicit English female found in first page. Using generic female:");
    console.log(`- ID: ${anyFemale._id} | Title: ${anyFemale.title} | Tags: ${anyFemale.tags.join(",")}`);
  }
}).catch(console.error);
